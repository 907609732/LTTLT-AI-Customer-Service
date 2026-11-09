package lingtu

import (
	"context"
	"errors"
	"reflect"
	"sync/atomic"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

var encryptionVault atomic.Pointer[Vault]

func SetEncryptionVault(v *Vault) { encryptionVault.Store(v) }

// GORM's serializer runs for struct writes, but its map Update/Updates path
// bypasses it. Protect that path before SQL construction as well.
func InstallSecretUpdateProtection(db *gorm.DB) error {
	return db.Callback().Update().Before("gorm:update").Register("lingtu:encrypt_secret_map", func(tx *gorm.DB) {
		values, ok := tx.Statement.Dest.(map[string]any)
		if !ok || tx.Statement.Schema == nil {
			return
		}
		updated := make(map[string]any, len(values))
		for key, value := range values {
			updated[key] = value
		}
		for key, value := range values {
			field := tx.Statement.Schema.LookUpField(key)
			if field == nil || field.TagSettings["SERIALIZER"] != "lingtu_secret" {
				continue
			}
			text, ok := value.(string)
			if !ok {
				tx.AddError(errors.New("credential updates must be literal strings"))
				return
			}
			if text == "" {
				continue
			}
			vault := encryptionVault.Load()
			if vault == nil {
				tx.AddError(errors.New("managed credential encryption unavailable"))
				return
			}
			sealed, err := vault.Seal(field.Schema.Table+"."+field.DBName, []byte(text))
			if err != nil {
				tx.AddError(err)
				return
			}
			updated[key] = sealed
		}
		tx.Statement.Dest = updated
	})
}
func init() { schema.RegisterSerializer("lingtu_secret", secretSerializer{}) }

type secretSerializer struct{}

func (secretSerializer) Scan(ctx context.Context, field *schema.Field, dst reflect.Value, dbValue any) error {
	var text string
	switch value := dbValue.(type) {
	case nil:
	case string:
		text = value
	case []byte:
		text = string(value)
	default:
		return errors.New("invalid encrypted database credential")
	}
	if text == "" {
		field.ReflectValueOf(ctx, dst).SetString("")
		return nil
	}
	vault := encryptionVault.Load()
	if vault == nil {
		return errors.New("managed credential encryption unavailable")
	}
	plain, err := vault.Open(field.Schema.Table+"."+field.DBName, text)
	if err != nil {
		return err
	}
	field.ReflectValueOf(ctx, dst).SetString(string(plain))
	return nil
}
func (secretSerializer) Value(_ context.Context, field *schema.Field, _ reflect.Value, fieldValue any) (any, error) {
	text, ok := fieldValue.(string)
	if !ok {
		return nil, errors.New("invalid database credential type")
	}
	if text == "" {
		return "", nil
	}
	vault := encryptionVault.Load()
	if vault == nil {
		return nil, errors.New("managed credential encryption unavailable")
	}
	return vault.Seal(field.Schema.Table+"."+field.DBName, []byte(text))
}
