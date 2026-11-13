package lingtu

// ModelConnection binds a managed selection to one native encrypted channel.
// Credentials exist only in channels.key; no credential copy is made here.
type ModelConnection struct {
	ChannelID  int    `gorm:"primaryKey;autoIncrement:false"`
	Provider   string `gorm:"type:varchar(32);not null"`
	Name       string `gorm:"type:varchar(128);not null"`
	ModelID    string `gorm:"type:varchar(128);uniqueIndex;not null"`
	Enabled    bool
	Revision   int
	ConfigHash string `gorm:"type:varchar(64);not null"`
	TestedHash string `gorm:"type:varchar(64)"`
	TestStatus string `gorm:"type:varchar(16);not null"`
	TestedAt   int64
}

func (ModelConnection) TableName() string { return "lingtu_model_connections" }
