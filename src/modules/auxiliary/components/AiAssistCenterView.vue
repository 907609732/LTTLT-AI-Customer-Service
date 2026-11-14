<script setup lang="ts">
import IconMonitor from '@/shared/icons/IconMonitor.vue'
import IconSetting from '@/shared/icons/IconSetting.vue'
import IconLink from '@/shared/icons/IconLink.vue'
import IconTop from '@/shared/icons/IconTop.vue'
import IconMinus from '@/shared/icons/IconMinus.vue'
import IconClose from '@/shared/icons/IconClose.vue'
import assistSoundIcon from '@/assets/assist-sound-figma.png'
import IconChatDotRound from '@/shared/icons/IconChatDotRound.vue'
import IconWarning from '@/shared/icons/IconWarning.vue'
import pddIcon from '@/assets/platform-pdd-jnRpGwzN.png'
import douyinIcon from '@/assets/platform-doudian-Cyz3XQnL.png'
import { useAssistCenter } from '../use-assist-center'
import { conversationKey, conversationTime, relativeTime, type AssistTab } from '../assist-model'
const {
  runtime,
  task,
  tab,
  consultStatus,
  ticketMode,
  storeFilter,
  chosen,
  text,
  preferences,
  settingsOpen,
  soundOpen,
  closeOpen,
  phrasesOpen,
  correctionOpen,
  correctionMessageTs,
  correctionAnswer,
  correctionConfirmed,
  phraseQuery,
  phrases,
  buyerMessages,
  qualityRecord,
  workOrder,
  orderNote,
  platformBusy,
  platformError,
  platformStores,
  platformCount,
  ticketCount,
  pending,
  replied,
  handoffs,
  rows,
  current,
  currentStore,
  canSend,
  orders,
  storeName,
  storePlatform,
  receptionState,
  markDraftEdited,
  select,
  saveDraft,
  send,
  clearReplied,
  selectTab,
  focusCurrent,
  resume,
  updatePreferences,
  soundTest,
  insertPhrase,
  keydown,
  openCorrection,
  correct,
  setOrderStatus,
  addOrderNote,
  openMain,
  syncPlatform,
  openPlatform,
  confirmClose,
  minimize,
} = useAssistCenter()
const tabs: { id: AssistTab; label: string }[] = [
  { id: 'consult', label: '咨询' },
  { id: 'handoff', label: '预警' },
  { id: 'ticket', label: '工单' },
  { id: 'aftersale', label: '售后' },
]
const iconFor = (platform: string) =>
  platform === 'pdd-web' ? pddIcon : platform === 'doudian-client' ? douyinIcon : ''
const orderLabels = { pending: '待处理', working: '处理中', waiting: '等待跟进', done: '已完成' }
</script>
<template>
  <section class="assist-center" aria-label="AI 辅助中心" tabindex="-1" @keydown="keydown">
    <header class="assist-titlebar" data-window-drag>
      <span class="assist-brand"><IconMonitor /><b>AI 辅助中心</b></span>
      <div class="assist-window-actions" data-no-drag>
        <button
          aria-label="提示音"
          class="assist-sound-button"
          :class="{ active: preferences.soundEnabled }"
          @click="soundOpen = !soundOpen"
        >
          <img :src="assistSoundIcon" alt="" width="25" height="26" />
        </button>
        <button aria-label="辅助中心设置" @click="settingsOpen = true"><IconSetting /></button>
        <button
          aria-label="吸附主窗口"
          :aria-pressed="preferences.docked"
          :class="{ active: preferences.docked }"
          @click="updatePreferences({ docked: !preferences.docked })"
        >
          <IconLink />
        </button>
        <button
          aria-label="浮窗置顶"
          :aria-pressed="preferences.pinned"
          :class="{ active: preferences.pinned }"
          @click="updatePreferences({ pinned: !preferences.pinned })"
        >
          <IconTop />
        </button>
        <button aria-label="最小化辅助中心" @click="minimize"><IconMinus /></button>
        <button aria-label="关闭辅助中心" @click="closeOpen = true"><IconClose /></button>
      </div>
    </header>
    <div v-if="soundOpen" class="assist-sound-panel">
      <label
        ><input
          type="checkbox"
          :checked="preferences.soundEnabled"
          @change="updatePreferences({ soundEnabled: ($event.target as HTMLInputElement).checked })"
        />声音提醒</label
      >
      <label
        >音量<input
          type="range"
          min="0"
          max="1"
          step="0.05"
          :value="preferences.volume"
          aria-label="提示音音量"
          @change="
            updatePreferences({ volume: Number(($event.target as HTMLInputElement).value) })
          " /></label
      ><button @click="soundTest">试听</button>
    </div>
    <nav class="assist-tabs" aria-label="辅助功能">
      <button
        v-for="item in tabs"
        :key="item.id"
        :data-assist-tab="item.id"
        :class="{ active: tab === item.id }"
        :aria-pressed="tab === item.id"
        @click="selectTab(item.id)"
      >
        {{ item.label
        }}<small>{{
          item.id === 'consult'
            ? pending.length
            : item.id === 'handoff'
              ? handoffs.length
              : item.id === 'ticket'
                ? ticketCount
                : platformCount('aftersale')
        }}</small>
      </button>
    </nav>
    <div v-if="!runtime.available" class="assist-preview-notice">浏览器只读预览</div>
    <div v-if="task.error.value || platformError" class="assist-feedback error" role="alert">
      {{ task.error.value || platformError }}
    </div>
    <div v-else-if="task.message.value" class="assist-feedback" role="status">
      {{ task.message.value }}
    </div>
    <template v-if="tab === 'consult' || tab === 'handoff'">
      <div class="assist-toolbar">
        <template v-if="tab === 'consult'"
          ><button
            data-consult-status="pending"
            :class="{ active: consultStatus === 'pending' }"
            @click="consultStatus = 'pending'"
          >
            待回复 <small>{{ pending.length }}</small></button
          ><button
            data-consult-status="replied"
            :class="{ active: consultStatus === 'replied' }"
            @click="consultStatus = 'replied'"
          >
            已回复 <small>{{ replied.length }}</small>
          </button></template
        ><span v-else>需转人工</span><span class="assist-spacer"></span
        ><button
          v-if="tab === 'consult' && consultStatus === 'replied'"
          aria-label="清除已回复显示"
          @click="clearReplied"
        >
          清除</button
        ><button v-else-if="tab === 'consult'" :disabled="!current" @click="openCorrection">
          纠错</button
        ><select
          v-if="tab === 'handoff'"
          v-model="storeFilter"
          class="assist-inline-filter"
          aria-label="辅助中心店铺筛选"
          :disabled="task.pending.value"
        >
          <option value="">全部店铺</option>
          <option v-for="shop in runtime.snapshot.stores" :key="shop.id" :value="shop.id">
            {{ shop.storeName || '待识别店铺' }}
          </option></select
        ><button
          v-if="tab === 'consult'"
          aria-label="切换会话排序"
          @click="updatePreferences({ sort: preferences.sort === 'newest' ? 'oldest' : 'newest' })"
        >
          {{ preferences.sort === 'newest' ? '最新优先' : '最早优先' }}
        </button>
      </div>
      <div class="assist-feed">
        <button
          v-for="row in rows"
          :key="conversationKey(row)"
          :data-conversation="conversationKey(row)"
          :class="['assist-conversation', { selected: chosen === conversationKey(row) }]"
          :disabled="task.pending.value"
          @click="select(row)"
        >
          <img
            v-if="iconFor(storePlatform(row.storeId))"
            :src="iconFor(storePlatform(row.storeId))"
            alt=""
          /><span v-else class="assist-platform-fallback">店</span
          ><span class="assist-conversation-main"
            ><span class="assist-conversation-top"
              ><b>{{ row.name || row.uid }}</b
              ><span class="assist-shop">{{ storeName(row.storeId) }}</span
              ><span :class="['assist-state', { warning: row.status === 'handoff' }]">{{
                receptionState(row)
              }}</span></span
            ><span class="assist-preview">{{
              row.messages.at(-1)?.content || '暂无保留消息'
            }}</span></span
          ><span class="assist-conversation-side"
            ><time>{{ relativeTime(conversationTime(row)) }}</time
            ><span v-if="row.status === 'replied'" class="assist-check">✓</span></span
          >
        </button>
        <div v-if="!rows.length" class="assist-empty">
          <div class="assist-empty-card">
            <span class="assist-empty-icon" :class="{ soft: tab !== 'consult' }"
              ><IconWarning v-if="tab === 'handoff'" /><IconChatDotRound v-else /></span
            ><strong>{{
              tab === 'handoff'
                ? '暂无人工预警'
                : consultStatus === 'replied'
                  ? '暂无已回复会话'
                  : '暂无待回复'
            }}</strong>
            <p>{{ runtime.available ? '登录店铺后开始接待' : '浏览器仅提供界面预览' }}</p>
          </div>
        </div>
      </div>
      <div v-if="current" class="assist-current">
        <div class="assist-current-heading">
          <b>{{ current.name || current.uid }}</b
          ><span>{{ storeName(current.storeId) }}</span
          ><button @click="focusCurrent">定位</button
          ><button v-if="current.status === 'handoff'" @click="resume">恢复 AI</button>
        </div>
        <div class="assist-current-message">
          <span>最新</span
          >{{
            current.messages.filter((message) => message.from === 'buyer').at(-1)?.content ||
            '无保留的买家消息'
          }}
        </div>
        <div class="assist-current-message">
          <span>人工</span
          >{{
            current.messages.filter((message) => message.from === 'seller').at(-1)?.content ||
            '尚无客服回复'
          }}<button @click="openCorrection">纠错</button>
        </div>
        <details>
          <summary>查看已采集会话</summary>
          <div role="log" aria-label="真实会话" class="assist-message-history">
            <p v-for="(message, index) in current.messages" :key="message.msgId || index">
              <b>{{
                message.from === 'buyer' ? '顾客' : message.from === 'seller' ? '客服' : '系统'
              }}</b
              >{{ message.type === 'image' ? '[图片] ' : '' }}{{ message.content }}
            </p>
          </div>
        </details>
      </div>
      <footer class="assist-composer">
        <div class="assist-recipient">
          <span>{{
            current
              ? `发给 ${current.name || current.uid}`
              : tab === 'handoff'
                ? '选择预警后回复'
                : '选择会话后回复'
          }}</span
          ><span :title="currentStore?.storeName">{{ currentStore?.storeName }}</span>
        </div>
        <div class="assist-composer-tools">
          <small v-if="current">订单状态未知</small><span class="assist-spacer"></span
          ><kbd>Ctrl+Tab</kbd
          ><button :disabled="!current || task.pending.value" @click="saveDraft">存草稿</button
          ><button :disabled="!current" @click="phrasesOpen = true">快捷</button>
        </div>
        <div class="assist-composer-input">
          <textarea
            v-model="text"
            maxlength="2000"
            rows="2"
            aria-label="人工回复内容"
            @input="markDraftEdited"
            :disabled="!current || task.pending.value"
            :placeholder="current ? '回车发给当前顾客 · 快捷可导入话术' : '选择会话后可输入回复'"
          ></textarea
          ><button
            class="assist-primary"
            aria-label="发送给当前顾客"
            :disabled="!canSend"
            @click="send"
          >
            {{ task.pending.value ? '处理中' : '发送' }}
          </button>
        </div>
      </footer>
    </template>
    <template v-else>
      <div v-if="tab === 'ticket'" class="assist-ticket-modes">
        <button :class="{ active: ticketMode === 'platform' }" @click="ticketMode = 'platform'">
          平台工单 {{ platformCount('ticket') }}</button
        ><button :class="{ active: ticketMode === 'local' }" @click="ticketMode = 'local'">
          客服工单 {{ orders.length }}
        </button>
      </div>
      <template v-if="tab === 'ticket' && ticketMode === 'local'"
        ><div class="assist-toolbar">
          <span>未完结客服工单</span><span class="assist-spacer"></span
          ><button @click="openMain('workorder')">登记</button>
        </div>
        <div class="assist-feed">
          <button
            v-for="order in orders"
            :key="order.id"
            class="assist-workorder"
            @click="workOrder = order"
          >
            <b>{{ order.type }} · {{ orderLabels[order.status] }}</b>
            <p>{{ order.description }}</p>
            <small>{{ order.storeName }} · {{ order.orderNo || '未填写订单号' }}</small>
          </button>
          <div v-if="!orders.length" class="assist-empty">
            <div class="assist-empty-card">
              <span class="assist-empty-icon soft"><IconMonitor /></span
              ><strong>还没有客服工单</strong>
              <p>聊天里没办完、还要按订单跟的事，在工单登记里添加。</p>
              <button @click="openMain('workorder')">去登记</button>
            </div>
          </div>
        </div></template
      >
      <template v-else
        ><div class="assist-toolbar">
          <span>{{ tab === 'aftersale' ? '售后聚合' : '待处理工单' }}</span
          ><span class="assist-spacer"></span
          ><button :disabled="platformBusy" @click="syncPlatform(true)">
            {{ platformBusy ? '同步中' : '刷新' }}</button
          ><select
            v-model="storeFilter"
            class="assist-inline-filter"
            aria-label="辅助中心店铺筛选"
            :disabled="task.pending.value"
          >
            <option value="">全部店铺</option>
            <option v-for="shop in runtime.snapshot.stores" :key="shop.id" :value="shop.id">
              {{ shop.storeName || '待识别店铺' }}
            </option>
          </select>
        </div>
        <div class="assist-feed assist-platform-feed">
          <article
            v-for="record in platformStores"
            :key="`${record.storeId}:${record.kind}`"
            class="assist-sync-store"
          >
            <header>
              <b>{{ record.storeName || '待识别店铺' }}</b
              ><button :disabled="task.pending.value" @click="openPlatform(record)">
                {{ record.status === 'login_required' ? '登录后台' : '打开后台' }}
              </button>
            </header>
            <p :class="['assist-sync-status', record.status]">
              {{
                record.message ||
                (record.status === 'success' ? `已同步 ${record.total ?? '未知'} 条` : '等待同步')
              }}
            </p>
            <small v-if="record.lastSyncedAt"
              >上次同步 {{ relativeTime(record.lastSyncedAt)
              }}{{ record.complete ? '' : ' · 数据未完整读取' }}</small
            ><button
              v-for="item in record.items"
              :key="item.id"
              class="assist-platform-item"
              @click="openPlatform(record, item)"
            >
              <b>{{ item.title }}</b
              ><span
                >{{ item.status }}<template v-if="item.amount"> · {{ item.amount }}</template></span
              ><small v-if="item.orderNo">订单 {{ item.orderNo }}</small
              ><small v-if="item.deadline">时限 {{ item.deadline }}</small
              ><span class="assist-platform-open">到平台处理 →</span>
            </button>
            <p v-if="record.status === 'success' && record.total === 0">
              暂无{{ tab === 'aftersale' ? '待处理售后' : '待处理工单' }}
            </p>
          </article>
          <div v-if="!platformStores.length" class="assist-empty">
            <div class="assist-empty-card">
              <span class="assist-empty-icon soft"><IconMonitor /></span
              ><strong>{{ platformBusy ? '正在同步' : '等待平台同步' }}</strong>
              <p>
                {{
                  runtime.snapshot.stores.length
                    ? '点击刷新读取已登录后台；未登录时需先完成登录。'
                    : '请先添加拼多多店铺，再同步真实平台事项。'
                }}
              </p>
            </div>
          </div>
        </div></template
      >
    </template>
    <el-dialog
      v-model="settingsOpen"
      title="辅助中心设置"
      class="assist-modal"
      width="calc(100% - 16px)"
      align-center
      append-to-body
      ><div class="assist-settings">
        <p v-if="task.error.value" class="assist-dialog-error" role="alert">
          {{ task.error.value }}
        </p>
        <label
          >店铺筛选<select
            v-model="storeFilter"
            aria-label="辅助中心店铺筛选"
            :disabled="task.pending.value"
          >
            <option value="">全部店铺</option>
            <option v-for="shop in runtime.snapshot.stores" :key="shop.id" :value="shop.id">
              {{ shop.storeName || '待识别店铺' }}
            </option>
          </select></label
        >
        <label
          >会话排序<select
            :value="preferences.sort"
            aria-label="辅助中心排序"
            @change="
              updatePreferences({
                sort: ($event.target as HTMLSelectElement).value as 'newest' | 'oldest',
              })
            "
          >
            <option value="newest">最新优先</option>
            <option value="oldest">最早优先</option>
          </select></label
        >
        <label
          ><input
            type="checkbox"
            :checked="preferences.soundEnabled"
            @change="
              updatePreferences({ soundEnabled: ($event.target as HTMLInputElement).checked })
            "
          />声音提醒</label
        ><label
          >音量<input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="preferences.volume"
            @change="
              updatePreferences({ volume: Number(($event.target as HTMLInputElement).value) })
            " /></label
        ><button @click="soundTest">试听</button
        ><label v-for="kind in tabs" :key="kind.id"
          ><input
            type="checkbox"
            :checked="preferences.alertKinds.includes(kind.id)"
            @change="
              updatePreferences({
                alertKinds: ($event.target as HTMLInputElement).checked
                  ? [...preferences.alertKinds.filter((value) => value !== kind.id), kind.id]
                  : preferences.alertKinds.filter((value) => value !== kind.id),
              })
            "
          />{{ kind.label }}提醒</label
        ><small>最小化继续提醒，关闭辅助中心停止提醒。AI 回复间隔在软件设置中调整。</small
        ><button @click="openMain('settings')">打开软件设置</button>
        <button @click="settingsOpen = false">完成</button>
      </div></el-dialog
    >
    <el-dialog
      v-model="closeOpen"
      title="关闭 AI 辅助中心"
      class="assist-modal"
      width="calc(100% - 16px)"
      align-center
      append-to-body
      ><p>
        关闭后将停止辅助中心消息聚合和人工预警提醒，店铺连接及 AI
        保持原状态。最小化可继续值守；关闭后可从主界面重新打开。
      </p>
      <p v-if="task.error.value" class="assist-dialog-error" role="alert">{{ task.error.value }}</p>
      <template #footer
        ><el-button @click="closeOpen = false">取消</el-button
        ><el-button type="primary" :loading="task.pending.value" @click="confirmClose"
          >关闭</el-button
        ></template
      ></el-dialog
    >
    <el-dialog
      v-model="phrasesOpen"
      title="快捷话术"
      class="assist-modal"
      width="calc(100% - 16px)"
      align-center
      append-to-body
      ><input
        v-model="phraseQuery"
        class="assist-search"
        aria-label="搜索快捷话术"
        placeholder="搜索场景或关键词"
      />
      <p class="assist-disclaimer">话术仅作表达参考，请核对本店实际情况后发送。</p>
      <div class="assist-phrases">
        <button v-for="phrase in phrases" :key="phrase.id" @click="insertPhrase(phrase)">
          <b>{{ phrase.intent }}</b
          ><span>{{ phrase.reply }}</span
          ><small>{{ phrase.avoid }}</small>
        </button>
        <p v-if="!phrases.length">没有匹配的话术</p>
      </div></el-dialog
    >
    <el-dialog
      v-model="correctionOpen"
      title="回复纠错"
      class="assist-modal"
      width="calc(100% - 16px)"
      align-center
      append-to-body
      ><div class="assist-settings">
        <p v-if="task.error.value" class="assist-dialog-error" role="alert">
          {{ task.error.value }}
        </p>
        <p v-if="!qualityRecord" role="alert">
          当前会话没有可用的质检记录，请同步会话后再保存纠错。
        </p>
        <label
          >买家原始问题<select v-model="correctionMessageTs" aria-label="纠错买家原始问题">
            <option v-for="message in buyerMessages" :key="message.ts" :value="message.ts">
              {{ message.content }}
            </option>
          </select></label
        ><label
          >标准答案<textarea
            v-model="correctionAnswer"
            rows="4"
            maxlength="4000"
            aria-label="纠错标准答案"
          ></textarea></label
        ><label
          ><input
            v-model="correctionConfirmed"
            type="checkbox"
          />确认保存为本店知识，不发送消息</label
        >
      </div>
      <template #footer
        ><el-button @click="correctionOpen = false">取消</el-button
        ><el-button
          type="primary"
          :disabled="!qualityRecord || !correctionConfirmed || !correctionAnswer.trim()"
          :loading="task.pending.value"
          @click="correct"
          >保存</el-button
        ></template
      ></el-dialog
    >
    <el-dialog
      :model-value="Boolean(workOrder)"
      title="客服工单"
      class="assist-modal"
      width="calc(100% - 16px)"
      align-center
      append-to-body
      @update:model-value="workOrder = undefined"
      ><div v-if="workOrder" class="assist-settings">
        <p v-if="task.error.value" class="assist-dialog-error" role="alert">
          {{ task.error.value }}
        </p>
        <b>{{ workOrder.type }} · {{ workOrder.storeName }}</b>
        <p>{{ workOrder.description }}</p>
        <small>订单：{{ workOrder.orderNo || '未填写' }}</small
        ><label
          >状态<select
            :value="workOrder.status"
            :disabled="task.pending.value"
            @change="
              setOrderStatus(($event.target as HTMLSelectElement).value as typeof workOrder.status)
            "
          >
            <option v-for="(label, value) in orderLabels" :key="value" :value="value">
              {{ label }}
            </option>
          </select></label
        >
        <p v-for="note in workOrder.notes" :key="note.id">{{ note.text }}</p>
        <textarea v-model="orderNote" rows="3" maxlength="2000" aria-label="工单跟进备注"></textarea
        ><button :disabled="!orderNote.trim() || task.pending.value" @click="addOrderNote">
          保存跟进
        </button>
      </div></el-dialog
    >
  </section>
</template>
<style src="../assist-center.css"></style>
