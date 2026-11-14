package lingtuteam

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Register requires the caller's existing authenticated group. Identity must
// derive only from that middleware, never a request body/header chosen by users.
// AccountExists checks the native account table without returning account PII.
func Register(group *gin.RouterGroup, s *Store, identity func(*gin.Context) int, accountExists func(int) (bool, error)) {
	fail := func(c *gin.Context, err error) {
		status, code := 503, "team_temporarily_unavailable"
		switch {
		case errors.Is(err, ErrForbidden):
			status, code = 403, err.Error()
		case errors.Is(err, ErrNotFound):
			status, code = 404, err.Error()
		case errors.Is(err, ErrConflict):
			status, code = 409, err.Error()
		case errors.Is(err, ErrInvalid):
			status, code = 400, err.Error()
		}
		c.AbortWithStatusJSON(status, gin.H{"error": code})
	}
	uid := func(c *gin.Context) int {
		if identity == nil {
			return 0
		}
		return identity(c)
	}
	teamID := func(c *gin.Context) (uint, error) {
		id, e := strconv.ParseUint(c.Param("team"), 10, 32)
		if e != nil || id == 0 {
			return 0, ErrInvalid
		}
		return uint(id), nil
	}
	bind := func(c *gin.Context, v interface{}) bool {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
		if c.ContentType() != "application/json" {
			fail(c, ErrInvalid)
			return false
		}
		d := json.NewDecoder(c.Request.Body)
		d.DisallowUnknownFields()
		if d.Decode(v) != nil {
			fail(c, ErrInvalid)
			return false
		}
		var extra interface{}
		if d.Decode(&extra) != io.EOF {
			fail(c, ErrInvalid)
			return false
		}
		return true
	}
	teams := group.Group("/teams", func(c *gin.Context) {
		if uid(c) <= 0 {
			c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized"})
			return
		}
		c.Header("Cache-Control", "no-store")
		c.Next()
	})
	teams.GET("", func(c *gin.Context) {
		rows, err := s.List(uid(c))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"teams": rows})
	})
	teams.POST("", func(c *gin.Context) {
		var request struct {
			Name string `json:"name"`
		}
		if !bind(c, &request) {
			return
		}
		row, err := s.Create(uid(c), request.Name)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(201, row)
	})
	teams.GET("/:team", func(c *gin.Context) {
		id, err := teamID(c)
		if err != nil {
			fail(c, err)
			return
		}
		snap, err := s.Snapshot(uid(c), id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, snap)
	})
	teams.POST("/:team/accept", func(c *gin.Context) {
		id, err := teamID(c)
		if err != nil {
			fail(c, err)
			return
		}
		var request struct{}
		if !bind(c, &request) {
			return
		}
		if err = s.Accept(uid(c), id); err != nil {
			fail(c, err)
			return
		}
		c.JSON(200, gin.H{"ok": true})
	})
	teams.POST("/:team/actions", func(c *gin.Context) {
		id, err := teamID(c)
		if err != nil {
			fail(c, err)
			return
		}
		var request Command
		if !bind(c, &request) {
			return
		}
		if request.Action == "invite" {
			// Authorize before checking the recipient, avoiding account enumeration by
			// non-owners. The write transaction still rechecks permission/revision.
			snap, e := s.Snapshot(uid(c), id)
			if e != nil {
				fail(c, e)
				return
			}
			if snap.Self.Role != "owner" {
				fail(c, ErrForbidden)
				return
			}
			if accountExists == nil {
				fail(c, errors.New("account validator unavailable"))
				return
			}
			exists, e := accountExists(request.UserID)
			if e != nil {
				fail(c, e)
				return
			}
			if !exists {
				fail(c, ErrInvalid)
				return
			}
		}
		if err = s.Execute(uid(c), id, request); err != nil {
			fail(c, err)
			return
		}
		// A write response is an acknowledgement, not a second read which could
		// fail after commit and tempt the client to repeat an already committed write.
		c.JSON(200, gin.H{"ok": true})
	})
}
