package lingtuhost

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/lingtuteam"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// Call once from Register after authenticated := group.Group("", h.clientAuth).
// Migration and route wiring belong together so partial startup fails closed.
func (h *Host) registerTeams(authenticated *gin.RouterGroup) error {
	store := lingtuteam.NewStore(model.DB)
	if err := store.Migrate(); err != nil {
		return err
	}
	lingtuteam.Register(authenticated, store, func(c *gin.Context) int { return identityOf(c).UserID }, func(uid int) (bool, error) {
		var count int64
		err := model.DB.Model(&model.User{}).Where("id = ? AND status = ?", uid, common.UserStatusEnabled).Count(&count).Error
		return count == 1, err
	})
	return nil
}
