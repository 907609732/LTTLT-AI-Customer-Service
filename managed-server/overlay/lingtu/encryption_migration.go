package lingtu

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type encryptionState struct {
	ID      int `gorm:"primaryKey;autoIncrement:false"`
	Version int
}

func (encryptionState) TableName() string { return "lingtu_encryption_state" }

// Called after native schema migration and before native option/session setup or
// the HTTP listener. The durable marker makes the whole conversion idempotent;
// plaintext values such as "v1.0.0" must never be guessed to be ciphertext.
func EncryptLegacyCredentials(db *gorm.DB) error {
	vault, err := RuntimeVault()
	if err != nil {
		return err
	}
	if err = db.AutoMigrate(&encryptionState{}); err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		var state encryptionState
		err := tx.First(&state, 1).Error
		if err == nil {
			if state.Version != 1 {
				return errors.New("unsupported managed encryption schema")
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		for _, column := range []struct{ table, primary, field string }{{"channels", "id", "key"}, {"options", "key", "value"}, {"custom_oauth_providers", "id", "client_secret"}} {
			if !tx.Migrator().HasTable(column.table) {
				continue
			}
			for offset := 0; ; offset += 100 {
				var rows []map[string]any
				if err := legacyCredentialQuery(tx, column.table, column.primary, column.field, offset).Find(&rows).Error; err != nil {
					return err
				}
				for _, row := range rows {
					var plain string
					switch value := row[column.field].(type) {
					case nil:
					case string:
						plain = value
					case []byte:
						plain = string(value)
					default:
						return errors.New("invalid legacy credential column")
					}
					if plain == "" {
						continue
					}
					sealed, err := vault.Seal(column.table+"."+column.field, []byte(plain))
					if err != nil {
						return err
					}
					if err = tx.Table(column.table).Where(map[string]any{column.primary: row[column.primary]}).Update(column.field, sealed).Error; err != nil {
						return err
					}
				}
				if len(rows) < 100 {
					break
				}
			}
		}
		return tx.Create(&encryptionState{ID: 1, Version: 1}).Error
	})
}

func legacyCredentialQuery(db *gorm.DB, table, primary, field string, offset int) *gorm.DB {
	return db.Table(table).Clauses(
		clause.Select{Columns: []clause.Column{{Name: primary}, {Name: field}}},
		clause.OrderBy{Columns: []clause.OrderByColumn{{Column: clause.Column{Name: primary}}}},
	).Offset(offset).Limit(100)
}
