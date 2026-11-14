package lingtuhost

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/lingtu"
	"github.com/QuantumNous/new-api/lingtuteam"
	"github.com/gin-gonic/gin"
)

// Exercises the same authenticated registration used by the desktop, with real
// SQLite and encrypted session tokens. No merchant, payment provider or model is contacted.
func TestParallelTeamAndBillingRegisteredIntegration(t *testing.T) {
	db := hostDB(t)
	now := time.Now()
	for _, uid := range []int{501, 502} {
		if err := db.Create(&accountUserFixture{ID: uid, Username: fmt.Sprintf("parallel-%d", uid), DisplayName: "isolated", Status: 1}).Error; err != nil {
			t.Fatal(err)
		}
		if err := lingtu.EnsureManagedAccount(db, uid, now); err != nil {
			t.Fatal(err)
		}
	}
	vault, err := lingtu.RuntimeVault()
	if err != nil {
		t.Fatal(err)
	}
	sessions := lingtu.NewSessionStore(db, vault, "https://parallel.invalid", func(int, string, int64) error { return nil })
	if err = sessions.Migrate(); err != nil {
		t.Fatal(err)
	}
	owner, err := sessions.Create(501, "owner-native", 1, now)
	if err != nil {
		t.Fatal(err)
	}
	member, err := sessions.Create(502, "member-native", 1, now)
	if err != nil {
		t.Fatal(err)
	}
	h := &Host{sessions: sessions}
	router := gin.New()
	group := router.Group("/api/client", h.clientAuth)
	if err = h.registerTeams(group); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LINGTU_BILLING_STRIPE_SECRET_KEY", "")
	t.Setenv("LINGTU_BILLING_STRIPE_WEBHOOK_SECRET", "")
	t.Setenv("LINGTU_BILLING_PLANS", "")
	if err = RegisterBilling(router, group, db, "https://parallel.invalid"); err != nil {
		t.Fatal(err)
	}
	request := func(token, method, path string, body interface{}, expected int) []byte {
		t.Helper()
		var payload []byte
		if body != nil {
			payload, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, "/api/client"+path, bytes.NewReader(payload))
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		if recorder.Code != expected {
			t.Fatalf("%s %s: %d %s", method, path, recorder.Code, recorder.Body.String())
		}
		return recorder.Body.Bytes()
	}
	request("", "GET", "/teams", nil, 401)
	raw := request(owner.AccessToken, "POST", "/teams", map[string]interface{}{"name": "并行集成验收"}, 201)
	var team lingtuteam.Team
	if err = json.Unmarshal(raw, &team); err != nil {
		t.Fatal(err)
	}
	base := fmt.Sprintf("/teams/%d", team.ID)
	revision := func() int64 {
		var snapshot struct {
			Team struct {
				Revision int64 `json:"revision"`
			} `json:"team"`
		}
		if err = json.Unmarshal(request(owner.AccessToken, "GET", base, nil, 200), &snapshot); err != nil {
			t.Fatal(err)
		}
		return snapshot.Team.Revision
	}
	action := func(values map[string]interface{}) {
		values["revision"] = revision()
		request(owner.AccessToken, "POST", base+"/actions", values, 200)
	}
	action(map[string]interface{}{"action": "invite", "userId": 502, "role": "agent"})
	invited := request(member.AccessToken, "GET", "/teams", nil, 200)
	if !bytes.Contains(invited, []byte(`"invited"`)) {
		t.Fatal("invitation absent")
	}
	request(member.AccessToken, "POST", base+"/accept", map[string]interface{}{}, 200)
	action(map[string]interface{}{"action": "register-shop", "shopId": "isolated-store", "name": "隔离店"})
	action(map[string]interface{}{"action": "grant", "userId": 502, "shopId": "isolated-store", "allowed": true})
	action(map[string]interface{}{"action": "create-ticket", "shopId": "isolated-store", "text": "合成工单"})
	var snapshot struct {
		Tickets []struct {
			ID uint `json:"id"`
		} `json:"tickets"`
	}
	if err = json.Unmarshal(request(owner.AccessToken, "GET", base, nil, 200), &snapshot); err != nil || len(snapshot.Tickets) != 1 {
		t.Fatal("ticket missing", err)
	}
	action(map[string]interface{}{"action": "assign", "ticketId": snapshot.Tickets[0].ID, "userId": 502})
	visible := request(member.AccessToken, "GET", base, nil, 200)
	if !bytes.Contains(visible, []byte("合成工单")) {
		t.Fatal("assigned ticket not visible")
	}
	action(map[string]interface{}{"action": "grant", "userId": 502, "shopId": "isolated-store", "allowed": false})
	hidden := request(member.AccessToken, "GET", base, nil, 200)
	if bytes.Contains(hidden, []byte("合成工单")) {
		t.Fatal("revoked shop still visible")
	}
	// Buying calls must remain possible after the AI pool is exhausted or expired.
	if err = db.Model(&lingtu.TrialGrant{}).Where("user_id = ?", 501).Updates(map[string]interface{}{"call_limit": 0, "expires_at": now.Add(-time.Hour).Unix()}).Error; err != nil {
		t.Fatal(err)
	}
	catalog := request(owner.AccessToken, "GET", "/billing", nil, 200)
	if !bytes.Contains(catalog, []byte(`"ready":false`)) {
		t.Fatal("missing merchant configuration must disable payment")
	}
	request(owner.AccessToken, "GET", "/billing/orders", nil, 200)
	request(owner.AccessToken, "POST", "/billing/orders", map[string]interface{}{"plan_id": "not-configured", "request_id": "isolated-request"}, 503)
}
