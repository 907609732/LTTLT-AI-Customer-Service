// Package lingtuteam owns software-team authorization. A shop record is not a
// marketplace credential and never authorizes a platform login or buyer action.
package lingtuteam

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
)

var (
	ErrForbidden = errors.New("team_forbidden")
	ErrNotFound  = errors.New("team_not_found")
	ErrConflict  = errors.New("team_revision_conflict")
	ErrInvalid   = errors.New("team_invalid_request")
)

type Team struct {
	ID       uint   `json:"id" gorm:"primaryKey"`
	OwnerID  int    `json:"ownerId" gorm:"not null;uniqueIndex"`
	Name     string `json:"name" gorm:"size:80;not null"`
	Revision int64  `json:"revision" gorm:"not null"`
}

func (Team) TableName() string { return "lingtu_teams" }

type Member struct {
	TeamID uint   `json:"teamId" gorm:"primaryKey"`
	UserID int    `json:"userId" gorm:"primaryKey"`
	Role   string `json:"role" gorm:"size:16;not null"`
	State  string `json:"state" gorm:"size:16;not null"`
}

func (Member) TableName() string { return "lingtu_team_members" }

type Shop struct {
	TeamID uint   `json:"teamId" gorm:"primaryKey"`
	ID     string `json:"id" gorm:"primaryKey;size:128"`
	Name   string `json:"name" gorm:"size:80;not null"`
}

func (Shop) TableName() string { return "lingtu_team_shops" }

type Grant struct {
	TeamID uint   `json:"teamId" gorm:"primaryKey"`
	UserID int    `json:"userId" gorm:"primaryKey"`
	ShopID string `json:"shopId" gorm:"primaryKey;size:128"`
}

func (Grant) TableName() string { return "lingtu_team_shop_grants" }

type Ticket struct {
	ID        uint   `json:"id" gorm:"primaryKey"`
	TeamID    uint   `json:"teamId" gorm:"not null;index"`
	ShopID    string `json:"shopId" gorm:"size:128;not null"`
	Text      string `json:"text" gorm:"size:4000;not null"`
	Status    string `json:"status" gorm:"size:16;not null"`
	Assignee  int    `json:"assignee" gorm:"not null"`
	CreatedBy int    `json:"createdBy" gorm:"not null"`
}

func (Ticket) TableName() string { return "lingtu_team_tickets" }

type Note struct {
	ID       uint   `json:"id" gorm:"primaryKey"`
	TeamID   uint   `json:"teamId" gorm:"not null;index"`
	TicketID uint   `json:"ticketId" gorm:"not null;index"`
	UserID   int    `json:"userId" gorm:"not null"`
	Text     string `json:"text" gorm:"size:2000;not null"`
	At       int64  `json:"at" gorm:"not null"`
}

func (Note) TableName() string { return "lingtu_team_ticket_notes" }

type Audit struct {
	ID       uint   `json:"id" gorm:"primaryKey"`
	TeamID   uint   `json:"teamId" gorm:"not null;index"`
	Actor    int    `json:"actor" gorm:"not null"`
	Action   string `json:"action" gorm:"size:40;not null"`
	UserID   int    `json:"userId"`
	ShopID   string `json:"shopId" gorm:"size:128"`
	TicketID uint   `json:"ticketId"`
	Role     string `json:"role" gorm:"size:16"`
	Active   bool   `json:"active"`
	Allowed  bool   `json:"allowed"`
	Status   string `json:"status" gorm:"size:16"`
	At       int64  `json:"at" gorm:"not null"`
}

func (Audit) TableName() string { return "lingtu_team_audits" }

type Snapshot struct {
	Team    Team     `json:"team"`
	Self    Member   `json:"self"`
	Members []Member `json:"members"`
	Shops   []Shop   `json:"shops"`
	Grants  []Grant  `json:"grants"`
	Tickets []Ticket `json:"tickets"`
	Notes   []Note   `json:"notes"`
	Audits  []Audit  `json:"audits"`
}
type Command struct {
	Action   string `json:"action"`
	Revision int64  `json:"revision"`
	UserID   int    `json:"userId,omitempty"`
	Role     string `json:"role,omitempty"`
	Active   bool   `json:"active,omitempty"`
	ShopID   string `json:"shopId,omitempty"`
	Name     string `json:"name,omitempty"`
	Allowed  bool   `json:"allowed,omitempty"`
	TicketID uint   `json:"ticketId,omitempty"`
	Text     string `json:"text,omitempty"`
	Status   string `json:"status,omitempty"`
}
type Store struct{ db *gorm.DB }

func NewStore(db *gorm.DB) *Store { return &Store{db: db} }
func (s *Store) Migrate() error {
	return s.db.AutoMigrate(&Team{}, &Member{}, &Shop{}, &Grant{}, &Ticket{}, &Note{}, &Audit{})
}
func textOK(v string, limit int) bool {
	return strings.TrimSpace(v) != "" && utf8.ValidString(v) && utf8.RuneCountInString(v) <= limit
}
func roleOK(role string) bool { return role == "admin" || role == "agent" || role == "auditor" }
func manager(m Member) bool   { return m.Role == "owner" || m.Role == "admin" }
func activeMember(db *gorm.DB, team uint, uid int) (Member, error) {
	var m Member
	err := db.First(&m, "team_id = ? AND user_id = ? AND state = ?", team, uid, "active").Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return m, ErrForbidden
	}
	return m, err
}
func audit(db *gorm.DB, team uint, uid int, c Command) error {
	return db.Create(&Audit{TeamID: team, Actor: uid, Action: c.Action, UserID: c.UserID, ShopID: c.ShopID, TicketID: c.TicketID, Role: c.Role, Active: c.Active, Allowed: c.Allowed, Status: c.Status, At: time.Now().Unix()}).Error
}
func (s *Store) Create(uid int, name string) (Team, error) {
	var team Team
	if uid <= 0 || !textOK(name, 80) {
		return team, ErrInvalid
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&Team{}).Where("owner_id = ?", uid).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrConflict
		}
		team = Team{OwnerID: uid, Name: strings.TrimSpace(name), Revision: 1}
		if err := tx.Create(&team).Error; err != nil {
			return err
		}
		if err := tx.Create(&Member{TeamID: team.ID, UserID: uid, Role: "owner", State: "active"}).Error; err != nil {
			return err
		}
		return audit(tx, team.ID, uid, Command{Action: "create-team"})
	})
	return team, err
}

type Membership struct {
	Team   Team   `json:"team"`
	Member Member `json:"member"`
}

func (s *Store) List(uid int) ([]Membership, error) {
	out := []Membership{}
	if uid <= 0 {
		return out, ErrForbidden
	}
	// One joined statement keeps the membership decision and returned team
	// metadata consistent and avoids re-reading a revoked membership's team.
	var rows []struct {
		ID       uint
		OwnerID  int
		Name     string
		Revision int64
		UserID   int
		Role     string
		State    string
	}
	if err := s.db.Table("lingtu_team_members AS m").Joins("JOIN lingtu_teams AS t ON t.id = m.team_id").Select("t.id, t.owner_id, t.name, t.revision, m.user_id, m.role, m.state").Where("m.user_id = ? AND m.state IN ?", uid, []string{"active", "invited"}).Order("t.id").Scan(&rows).Error; err != nil {
		return out, err
	}
	for _, row := range rows {
		out = append(out, Membership{Team{ID: row.ID, OwnerID: row.OwnerID, Name: row.Name, Revision: row.Revision}, Member{TeamID: row.ID, UserID: row.UserID, Role: row.Role, State: row.State}})
	}
	return out, nil
}

// The addressed account accepts its own invitation; owner knowledge of an ID
// alone does not create an active membership or imply phone/email verification.
func (s *Store) Accept(uid int, id uint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&Team{}).Where("id = ?", id).UpdateColumn("revision", gorm.Expr("revision + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrForbidden
		}
		result = tx.Model(&Member{}).Where("team_id = ? AND user_id = ? AND state = ?", id, uid, "invited").Update("state", "active")
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrForbidden
		}
		return audit(tx, id, uid, Command{Action: "accept", UserID: uid})
	})
}
func authorizedShop(tx *gorm.DB, m Member, shop string) error {
	var n int64
	if err := tx.Model(&Shop{}).Where("team_id = ? AND id = ?", m.TeamID, shop).Count(&n).Error; err != nil {
		return err
	}
	if n != 1 {
		return ErrNotFound
	}
	if manager(m) {
		return nil
	}
	if err := tx.Model(&Grant{}).Where("team_id = ? AND user_id = ? AND shop_id = ?", m.TeamID, m.UserID, shop).Count(&n).Error; err != nil {
		return err
	}
	if n != 1 {
		return ErrForbidden
	}
	return nil
}
func (s *Store) Execute(uid int, id uint, c Command) error {
	if uid <= 0 || id == 0 || c.Revision <= 0 {
		return ErrInvalid
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		// Acquire the tenant write fence BEFORE reading membership/grants. This also
		// prevents a revoked permission from winning a concurrent assignment race.
		result := tx.Model(&Team{}).Where("id = ? AND revision = ?", id, c.Revision).UpdateColumn("revision", gorm.Expr("revision + 1"))
		if result.Error != nil {
			return result.Error
		}
		m, err := activeMember(tx, id, uid)
		if err != nil {
			return err
		}
		if result.RowsAffected != 1 {
			return ErrConflict
		}
		switch c.Action {
		case "invite", "member":
			if m.Role != "owner" || c.UserID <= 0 || c.UserID == uid || !roleOK(c.Role) {
				return ErrForbidden
			}
			var old Member
			err = tx.First(&old, "team_id = ? AND user_id = ?", id, c.UserID).Error
			if c.Action == "invite" {
				if err == nil && old.State != "disabled" {
					return ErrConflict
				}
				if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				old = Member{TeamID: id, UserID: c.UserID, Role: c.Role, State: "invited"}
				if err = tx.Save(&old).Error; err != nil {
					return err
				}
			} else {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrNotFound
				}
				if err != nil {
					return err
				}
				state := "disabled"
				if c.Active {
					if old.State != "active" {
						return ErrInvalid
					}
					state = "active"
				}
				if err = tx.Model(&old).Updates(map[string]interface{}{"role": c.Role, "state": state}).Error; err != nil {
					return err
				}
				// All role changes revoke grants and assignments, avoiding old privileges
				// silently returning when a suspended account is invited again.
				if err = tx.Where("team_id = ? AND user_id = ?", id, c.UserID).Delete(&Grant{}).Error; err != nil {
					return err
				}
				if err = tx.Model(&Ticket{}).Where("team_id = ? AND assignee = ?", id, c.UserID).Update("assignee", 0).Error; err != nil {
					return err
				}
			}
		case "register-shop":
			if m.Role != "owner" {
				return ErrForbidden
			}
			if !textOK(c.ShopID, 128) || !textOK(c.Name, 80) {
				return ErrInvalid
			}
			var n int64
			if err = tx.Model(&Shop{}).Where("team_id = ? AND id = ?", id, c.ShopID).Count(&n).Error; err != nil {
				return err
			}
			if n > 0 {
				return ErrConflict
			}
			if err = tx.Create(&Shop{TeamID: id, ID: c.ShopID, Name: strings.TrimSpace(c.Name)}).Error; err != nil {
				return err
			}
		case "grant":
			if m.Role != "owner" {
				return ErrForbidden
			}
			target, e := activeMember(tx, id, c.UserID)
			if e != nil {
				return e
			}
			if manager(target) {
				return ErrInvalid
			}
			if err = authorizedShop(tx, m, c.ShopID); err != nil {
				return err
			}
			if c.Allowed {
				if err = tx.Where(Grant{TeamID: id, UserID: c.UserID, ShopID: c.ShopID}).FirstOrCreate(&Grant{TeamID: id, UserID: c.UserID, ShopID: c.ShopID}).Error; err != nil {
					return err
				}
			} else {
				if err = tx.Where("team_id = ? AND user_id = ? AND shop_id = ?", id, c.UserID, c.ShopID).Delete(&Grant{}).Error; err != nil {
					return err
				}
				if err = tx.Model(&Ticket{}).Where("team_id = ? AND shop_id = ? AND assignee = ?", id, c.ShopID, c.UserID).Update("assignee", 0).Error; err != nil {
					return err
				}
			}
		case "create-ticket":
			if m.Role == "auditor" {
				return ErrForbidden
			}
			if !textOK(c.Text, 4000) {
				return ErrInvalid
			}
			if err = authorizedShop(tx, m, c.ShopID); err != nil {
				return err
			}
			ticket := Ticket{TeamID: id, ShopID: c.ShopID, Text: strings.TrimSpace(c.Text), Status: "pending", CreatedBy: uid}
			if err = tx.Create(&ticket).Error; err != nil {
				return err
			}
			c.TicketID = ticket.ID
		case "assign", "status", "note":
			var ticket Ticket
			err = tx.First(&ticket, "id = ? AND team_id = ?", c.TicketID, id).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNotFound
			}
			if err != nil {
				return err
			}
			if err = authorizedShop(tx, m, ticket.ShopID); err != nil {
				return err
			}
			if m.Role == "auditor" {
				return ErrForbidden
			}
			if c.Action == "assign" {
				if !manager(m) {
					return ErrForbidden
				}
				if c.UserID < 0 {
					return ErrInvalid
				}
				if c.UserID != 0 {
					target, e := activeMember(tx, id, c.UserID)
					if e != nil {
						return e
					}
					if target.Role == "auditor" {
						return ErrForbidden
					}
					if e = authorizedShop(tx, target, ticket.ShopID); e != nil {
						return e
					}
				}
				if err = tx.Model(&ticket).Update("assignee", c.UserID).Error; err != nil {
					return err
				}
			} else {
				if !manager(m) && ticket.Assignee != uid {
					return ErrForbidden
				}
				if c.Action == "status" {
					if c.Status != "pending" && c.Status != "working" && c.Status != "waiting" && c.Status != "done" {
						return ErrInvalid
					}
					if err = tx.Model(&ticket).Update("status", c.Status).Error; err != nil {
						return err
					}
				} else {
					if !textOK(c.Text, 2000) {
						return ErrInvalid
					}
					if err = tx.Create(&Note{TeamID: id, TicketID: ticket.ID, UserID: uid, Text: strings.TrimSpace(c.Text), At: time.Now().Unix()}).Error; err != nil {
						return err
					}
				}
			}
		default:
			return ErrInvalid
		}
		return audit(tx, id, uid, c)
	})
}

func (s *Store) Snapshot(uid int, id uint) (Snapshot, error) {
	out := Snapshot{Members: []Member{}, Shops: []Shop{}, Grants: []Grant{}, Tickets: []Ticket{}, Notes: []Note{}, Audits: []Audit{}}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		// Read fence ensures membership and all filtered records share the same
		// tenant revision even under READ COMMITTED database isolation.
		result := tx.Model(&Team{}).Where("id = ?", id).UpdateColumn("revision", gorm.Expr("revision"))
		if result.Error != nil {
			return result.Error
		}
		m, err := activeMember(tx, id, uid)
		if err != nil {
			return err
		}
		out.Self = m
		if err = tx.First(&out.Team, id).Error; err != nil {
			return err
		}
		if manager(m) {
			if err = tx.Where("team_id = ?", id).Order("user_id").Find(&out.Members).Error; err != nil {
				return err
			}
			if err = tx.Where("team_id = ?", id).Find(&out.Grants).Error; err != nil {
				return err
			}
			if err = tx.Where("team_id = ?", id).Order("id DESC").Limit(100).Find(&out.Audits).Error; err != nil {
				return err
			}
		} else {
			out.Members = append(out.Members, m)
			if err = tx.Where("team_id = ? AND user_id = ?", id, uid).Find(&out.Grants).Error; err != nil {
				return err
			}
		}
		shops := tx.Where("team_id = ?", id)
		if !manager(m) {
			shops = shops.Where("id IN (?)", tx.Model(&Grant{}).Select("shop_id").Where("team_id = ? AND user_id = ?", id, uid))
		}
		if err = shops.Order("id").Find(&out.Shops).Error; err != nil {
			return err
		}
		ids := []string{}
		for _, shop := range out.Shops {
			ids = append(ids, shop.ID)
		}
		if len(ids) == 0 {
			return nil
		}
		if err = tx.Where("team_id = ? AND shop_id IN ?", id, ids).Order("id DESC").Limit(200).Find(&out.Tickets).Error; err != nil {
			return err
		}
		ticketIDs := []uint{}
		for _, ticket := range out.Tickets {
			ticketIDs = append(ticketIDs, ticket.ID)
		}
		if len(ticketIDs) > 0 {
			return tx.Where("team_id = ? AND ticket_id IN ?", id, ticketIDs).Order("id DESC").Limit(500).Find(&out.Notes).Error
		}
		return nil
	})
	return out, err
}
