package lingtuteam

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func fixture(t *testing.T) *Store {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "team.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	t.Cleanup(func() { sql.Close() })
	s := NewStore(db)
	if err = s.Migrate(); err != nil {
		t.Fatal(err)
	}
	return s
}
func apply(t *testing.T, s *Store, uid int, id uint, c Command) Snapshot {
	t.Helper()
	snap, err := s.Snapshot(uid, id)
	if err != nil {
		t.Fatal(err)
	}
	c.Revision = snap.Team.Revision
	if err = s.Execute(uid, id, c); err != nil {
		t.Fatal(err)
	}
	snap, err = s.Snapshot(uid, id)
	if err != nil {
		t.Fatal(err)
	}
	return snap
}
func TestTeamConsentTenantIsolationAndAssignment(t *testing.T) {
	s := fixture(t)
	team, err := s.Create(10, "客服团队")
	if err != nil {
		t.Fatal(err)
	}
	other, _ := s.Create(90, "另一租户")
	snap := apply(t, s, 10, team.ID, Command{Action: "invite", UserID: 20, Role: "agent"})
	if _, err = s.Snapshot(20, team.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("pending member read: %v", err)
	}
	if err = s.Accept(21, team.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("wrong recipient: %v", err)
	}
	if err = s.Accept(20, team.ID); err != nil {
		t.Fatal(err)
	}
	snap = apply(t, s, 10, team.ID, Command{Action: "register-shop", ShopID: "pdd-a", Name: "A店"})
	snap = apply(t, s, 10, team.ID, Command{Action: "register-shop", ShopID: "pdd-b", Name: "B店"})
	if err = s.Execute(20, team.ID, Command{Action: "create-ticket", Revision: snap.Team.Revision, ShopID: "pdd-a", Text: "问题"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("ungranted write: %v", err)
	}
	apply(t, s, 10, team.ID, Command{Action: "grant", UserID: 20, ShopID: "pdd-a", Allowed: true})
	snap = apply(t, s, 20, team.ID, Command{Action: "create-ticket", ShopID: "pdd-a", Text: "物流问题"})
	ticket := snap.Tickets[0]
	if len(snap.Shops) != 1 {
		t.Fatalf("shop leak: %+v", snap.Shops)
	}
	snap = apply(t, s, 10, team.ID, Command{Action: "assign", TicketID: ticket.ID, UserID: 20})
	apply(t, s, 20, team.ID, Command{Action: "status", TicketID: ticket.ID, Status: "working"})
	apply(t, s, 20, team.ID, Command{Action: "note", TicketID: ticket.ID, Text: "已核对"})
	foreign, err := s.Snapshot(90, other.ID)
	if err != nil {
		t.Fatal(err)
	}
	err = s.Execute(90, other.ID, Command{Action: "assign", Revision: foreign.Team.Revision, TicketID: ticket.ID, UserID: 90})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign ticket mutation: %v", err)
	}
	apply(t, s, 10, team.ID, Command{Action: "grant", UserID: 20, ShopID: "pdd-a", Allowed: false})
	hidden, err := s.Snapshot(20, team.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(hidden.Tickets) != 0 || len(hidden.Shops) != 0 {
		t.Fatal("revoked data still visible")
	}
	owner, _ := s.Snapshot(10, team.ID)
	if owner.Tickets[0].Assignee != 0 {
		t.Fatal("revoked assignee retained")
	}
	if len(owner.Audits) < 8 {
		t.Fatal("mutation audit missing")
	}
}
func TestTeamRolesVersionsAndRemoval(t *testing.T) {
	s := fixture(t)
	team, _ := s.Create(1, "团队")
	apply(t, s, 1, team.ID, Command{Action: "invite", UserID: 2, Role: "admin"})
	s.Accept(2, team.ID)
	apply(t, s, 1, team.ID, Command{Action: "invite", UserID: 3, Role: "auditor"})
	s.Accept(3, team.ID)
	snap, _ := s.Snapshot(1, team.ID)
	if err := s.Execute(2, team.ID, Command{Action: "member", Revision: snap.Team.Revision, UserID: 1, Role: "agent", Active: false}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin elevated: %v", err)
	}
	if err := s.Execute(3, team.ID, Command{Action: "register-shop", Revision: snap.Team.Revision, ShopID: "x", Name: "店"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("auditor wrote: %v", err)
	}
	apply(t, s, 1, team.ID, Command{Action: "register-shop", ShopID: "x", Name: "店"})
	if err := s.Execute(1, team.ID, Command{Action: "register-shop", Revision: snap.Team.Revision, ShopID: "y", Name: "店"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale write: %v", err)
	}
	apply(t, s, 1, team.ID, Command{Action: "member", UserID: 2, Role: "admin", Active: false})
	if _, err := s.Snapshot(2, team.ID); !errors.Is(err, ErrForbidden) {
		t.Fatal("removed member can read")
	}
	owner, _ := s.Snapshot(1, team.ID)
	if err := s.Execute(1, team.ID, Command{Action: "member", Revision: owner.Team.Revision, UserID: 1, Role: "agent", Active: false}); !errors.Is(err, ErrForbidden) {
		t.Fatal("owner removed")
	}
}
