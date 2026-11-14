package lingtuteam

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTeamHTTPAuthenticationStrictInputAndConsent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := fixture(t)
	r := gin.New()
	checks := 0
	// Only this isolated test injects identities through a header. Production
	// Register receives Host.clientAuth's verified server-side identity.
	Register(r.Group("/api/client"), s, func(c *gin.Context) int { uid, _ := strconv.Atoi(c.GetHeader("X-Fixture-UID")); return uid }, func(uid int) (bool, error) { checks++; return uid == 2, nil })
	request := func(method, path, body string, uid int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/api/client"+path, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Fixture-UID", strconv.Itoa(uid))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	if w := request("GET", "/teams", "", 0); w.Code != 401 {
		t.Fatalf("anonymous %d", w.Code)
	}
	if w := request("POST", "/teams", `{"name":"T","ownerId":2}`, 1); w.Code != 400 {
		t.Fatalf("forged owner %d %s", w.Code, w.Body.String())
	}
	w := request("POST", "/teams", `{"name":"客服"}`, 1)
	if w.Code != 201 {
		t.Fatalf("create %d %s", w.Code, w.Body.String())
	}
	var team Team
	if err := json.Unmarshal(w.Body.Bytes(), &team); err != nil {
		t.Fatal(err)
	}
	path := "/teams/" + strconv.Itoa(int(team.ID))
	if w = request("GET", path, "", 2); w.Code != 403 {
		t.Fatalf("cross account read %d", w.Code)
	}
	cmd := func(uid int, c Command) *httptest.ResponseRecorder {
		snap, _ := s.Snapshot(1, team.ID)
		c.Revision = snap.Team.Revision
		b, _ := json.Marshal(c)
		return request("POST", path+"/actions", string(b), uid)
	}
	if w = cmd(2, Command{Action: "invite", UserID: 2, Role: "agent"}); w.Code != 403 || checks != 0 {
		t.Fatalf("unauthorized enumeration %d %d", w.Code, checks)
	}
	if w = cmd(1, Command{Action: "invite", UserID: 999, Role: "agent"}); w.Code != 400 {
		t.Fatalf("nonexistent account %d", w.Code)
	}
	if w = cmd(1, Command{Action: "invite", UserID: 2, Role: "agent"}); w.Code != 200 {
		t.Fatalf("invite %d %s", w.Code, w.Body.String())
	}
	if w = request("POST", path+"/accept", `{}`, 3); w.Code != 403 {
		t.Fatalf("wrong consent %d", w.Code)
	}
	if w = request("POST", path+"/accept", `{} {}`, 2); w.Code != 400 {
		t.Fatalf("trailing json %d", w.Code)
	}
	if w = request("POST", path+"/accept", `{}`, 2); w.Code != 200 {
		t.Fatalf("consent %d", w.Code)
	}
	if w = request("GET", path, "", 2); w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("authorized read %d", w.Code)
	}
	if w = cmd(2, Command{Action: "register-shop", ShopID: "x", Name: "店"}); w.Code != 403 {
		t.Fatalf("agent escalation %d", w.Code)
	}
	if w = request("POST", path+"/actions", `{"action":"register-shop","revision":1,"shopId":"x","name":"店"}`, 1); w.Code != 409 {
		t.Fatalf("stale %d", w.Code)
	}
	if w = request("GET", "/teams/invalid", "", 1); w.Code != 400 {
		t.Fatalf("invalid id %d", w.Code)
	}
}

func TestTeamRollbackAndAuditorCannotChangeTickets(t *testing.T) {
	s := fixture(t)
	team, _ := s.Create(1, "团队")
	apply(t, s, 1, team.ID, Command{Action: "register-shop", ShopID: "a", Name: "A"})
	apply(t, s, 1, team.ID, Command{Action: "invite", UserID: 2, Role: "auditor"})
	if err := s.Accept(2, team.ID); err != nil {
		t.Fatal(err)
	}
	apply(t, s, 1, team.ID, Command{Action: "grant", UserID: 2, ShopID: "a", Allowed: true})
	snap := apply(t, s, 1, team.ID, Command{Action: "create-ticket", ShopID: "a", Text: "问题"})
	for _, action := range []Command{{Action: "status", TicketID: snap.Tickets[0].ID, Status: "done"}, {Action: "assign", TicketID: snap.Tickets[0].ID, UserID: 2}, {Action: "note", TicketID: snap.Tickets[0].ID, Text: "越权"}} {
		action.Revision = snap.Team.Revision
		if err := s.Execute(2, team.ID, action); err != ErrForbidden {
			t.Fatalf("auditor action %s: %v", action.Action, err)
		}
	}
	after, _ := s.Snapshot(1, team.ID)
	if after.Team.Revision != snap.Team.Revision || len(after.Audits) != len(snap.Audits) || after.Tickets[0].Status != "pending" {
		t.Fatal("denied action did not roll back")
	}
	if err := s.Execute(1, team.ID, Command{Action: "assign", Revision: snap.Team.Revision, TicketID: snap.Tickets[0].ID, UserID: 2}); err != ErrForbidden {
		t.Fatalf("auditor assigned: %v", err)
	}
}

func TestTeamListIncludesPendingConsentAndExcludesRevokedMembers(t *testing.T) {
	s := fixture(t)
	team, err := s.Create(1, "团队")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Create(1, "重复团队"); err != ErrConflict {
		t.Fatalf("duplicate ownership: %v", err)
	}
	apply(t, s, 1, team.ID, Command{Action: "invite", UserID: 2, Role: "agent"})
	list, err := s.List(2)
	if err != nil || len(list) != 1 || list[0].Member.State != "invited" || list[0].Team.Name != "团队" {
		t.Fatalf("pending list: %+v %v", list, err)
	}
	list, err = s.List(9)
	if err != nil || len(list) != 0 {
		t.Fatalf("other account list: %+v %v", list, err)
	}
	apply(t, s, 1, team.ID, Command{Action: "member", UserID: 2, Role: "agent", Active: false})
	list, err = s.List(2)
	if err != nil || len(list) != 0 {
		t.Fatalf("revoked list: %+v %v", list, err)
	}
	if err = s.Accept(2, team.ID); err != ErrForbidden {
		t.Fatalf("revoked invitation accepted: %v", err)
	}
}
