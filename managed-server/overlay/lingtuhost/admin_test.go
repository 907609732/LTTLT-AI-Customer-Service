package lingtuhost

import (
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type accountUserFixture struct {
	ID          int `gorm:"primaryKey"`
	DisplayName string
	Email       string
	Username    string
	Password    string
}

func (accountUserFixture) TableName() string { return "users" }
func hostDB(t *testing.T) *gorm.DB {
	t.Helper()
	v, _ := lingtu.NewVault(bytes.Repeat([]byte{23}, 32))
	lingtu.SetEncryptionVault(v)
	var dialect gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "host.db"))
	engine := os.Getenv("LINGTU_TEST_ENGINE")
	dsn := os.Getenv("LINGTU_TEST_DSN")
	if engine == "mysql" {
		dialect = mysql.Open(dsn)
	} else if engine == "postgres" {
		dialect = postgres.Open(dsn)
	} else if engine != "" {
		t.Fatal("unsupported test engine")
	}
	db, err := gorm.Open(dialect, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if engine != "" {
		var database string
		query := "SELECT DATABASE()"
		if engine == "postgres" {
			query = "SELECT current_database()"
		}
		if err = db.Raw(query).Scan(&database).Error; err != nil || database != "lingtu_test" {
			t.Fatal("refusing to modify a non-test database")
		}
		if engine == "mysql" {
			// Match production's required Chinese-capable schema regardless of the
			// CI service image's database defaults. The DSN charset only sets the connection.
			db = db.Set("gorm:table_options", "CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci").Session(&gorm.Session{})
		}
		if err = db.Migrator().DropTable(&lingtu.TrialIdentityClaim{}, &lingtu.TrialVerifiedEmail{}, &model.UserOAuthBinding{}, &lingtu.TrialRequest{}, &lingtu.TrialGrant{}, &lingtu.ManagedSetting{}, &lingtu.ManagedAccount{}, &lingtu.ManagedAudit{}, &model.CustomOAuthProvider{}, &accountUserFixture{}); err != nil {
			t.Fatal(err)
		}
	}
	old := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = old; sql, _ := db.DB(); sql.Close() })
	if err = lingtu.InstallSecretUpdateProtection(db); err != nil {
		t.Fatal(err)
	}
	if err = lingtu.MigrateManaged(db); err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&accountUserFixture{}, &model.CustomOAuthProvider{}, &model.UserOAuthBinding{}); err != nil {
		t.Fatal(err)
	}
	return db
}
func TestLingtuAdminAccountListUsesRealTrialLedger(t *testing.T) {
	db := hostDB(t)
	if err := db.Create(&accountUserFixture{ID: 9, DisplayName: "Owner", Email: "owner9@example.test"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := lingtu.RecordVerifiedTrialEmail(db, 9, "owner9@example.test", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := lingtu.EnsureManagedAccount(db, 9, time.Now()); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", "/api/lingtu/admin/accounts?page=1", nil)
	(&Host{}).adminAccounts(c)
	if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"limit":20`) {
		t.Fatalf("%d %s", recorder.Code, recorder.Body.String())
	}
}
func TestLingtuSocialConfigurationPreservesOrExplicitlyClearsSecret(t *testing.T) {
	db := hostDB(t)
	h := &Host{}
	if err := h.saveSocial(configurationRequest{Section: "wechat", AppID: "app", Secret: "private-fixture", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := h.saveSocial(configurationRequest{Section: "wechat", AppID: "app", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	var row lingtu.ManagedSetting
	if err := db.First(&row, "name = ?", "ltwechat").Error; err != nil || !strings.Contains(row.Value, "private-fixture") {
		t.Fatal(err)
	}
	var raw string
	if err := db.Table("lingtu_settings").Select("value").Where("name = ?", "ltwechat").Scan(&raw).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, "private-fixture") {
		t.Fatal("OAuth secret stored as plaintext")
	}
	if err := h.saveSocial(configurationRequest{Section: "wechat", AppID: "app", ClearSecret: true}); err != nil {
		t.Fatal(err)
	}
	if err := h.saveSocial(configurationRequest{Section: "wechat", AppID: "app", Enabled: true}); err == nil {
		t.Fatal("cleared credential accepted")
	}
}
