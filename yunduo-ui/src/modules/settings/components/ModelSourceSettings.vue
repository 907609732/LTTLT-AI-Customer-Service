<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import type { Action } from '@/shared/contracts/backend'
import type { ModelSource } from '@/shared/contracts/managed'

const runtime = useRuntimeStore()
const task = useTask()
const draft = ref<ModelSource>({ ...runtime.snapshot.managed.configured })
const dirty = ref(false)
const reviewed = ref(false)
const managed = computed(() => runtime.snapshot.managed)
const session = computed(() => managed.value.session)
const labels = {
  signed_out: '尚未登录',
  authorizing: '等待浏览器授权',
  signed_in: '已登录',
  offline: '连接失败',
  expired: '登录已过期',
  disabled: '账号已停用',
}
watch(
  () => managed.value.configured,
  (value) => {
    if (!dirty.value) draft.value = { ...value }
  },
)
watch(
  () => runtime.snapshot.modelIssue?.at,
  () => {
    reviewed.value = false
  },
)
const date = (seconds: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(seconds * 1000)
async function action(action: Action) {
  await task.run(async () => {
    const result = await runtime.run({
      action,
      values: action === 'save-model-source' ? { ...draft.value } : {},
    })
    dirty.value = false
    task.message.value = result.message
  })
}
async function acknowledge() {
  const issue = runtime.snapshot.modelIssue
  if (!issue || !reviewed.value) return
  await task.run(async () => {
    const result = await runtime.run({
      action: 'acknowledge-model-issue',
      values: { confirmed: true, code: issue.code, at: issue.at },
    })
    reviewed.value = false
    task.message.value = result.message
  })
}
</script>

<template>
  <section class="model-source-settings" aria-label="模型来源与托管账号">
    <h2>模型来源与托管账号</h2>
    <p>
      本机模式使用自己的
      Key；托管模式使用服务端管理员分配的模型和额度。更换模式或账号后需重启，店铺与会话按账号独立保存。
    </p>
    <el-alert
      v-if="managed.restartRequired"
      title="模型来源或账号已改变，请重启软件后生效；AI 已停止。"
      type="warning"
      :closable="false"
    />
    <el-alert v-if="task.error.value" :title="task.error.value" type="error" :closable="false" />
    <el-alert
      v-if="task.message.value"
      :title="task.message.value"
      type="success"
      :closable="false"
    />
    <form class="runtime-form" @submit.prevent="action('save-model-source')">
      <label
        >模型来源<el-select
          v-model="draft.mode"
          aria-label="模型来源"
          :disabled="task.pending.value"
          @change="dirty = true"
        >
          <el-option label="本机自带 Key" value="local" /><el-option
            label="托管服务"
            value="managed"
          /> </el-select
      ></label>
      <label
        >托管 API 服务地址<el-input
          v-model="draft.apiOrigin"
          aria-label="托管 API 服务地址"
          :disabled="task.pending.value"
          @input="dirty = true"
      /></label>
      <label
        >托管账号网站<el-input
          v-model="draft.portalOrigin"
          aria-label="托管账号网站"
          :disabled="task.pending.value"
          @input="dirty = true"
      /></label>
      <p>
        当前运行：{{ managed.active.mode === 'local' ? '本机自带 Key' : '托管服务' }}。地址使用
        HTTPS，本机调试可用带端口的 http://127.0.0.1；保存不会登录账号或自动开启 AI。
      </p>
      <el-button
        native-type="submit"
        type="primary"
        :loading="task.pending.value"
        :disabled="!runtime.available"
        >保存模型来源</el-button
      >
    </form>
    <div class="managed-account">
      <h3>托管账号 · {{ labels[session.status] }}</h3>
      <el-alert v-if="session.message" :title="session.message" type="warning" :closable="false" />
      <p v-if="session.login">
        浏览器确认码：<strong>{{ session.login.userCode }}</strong
        >，有效至 {{ date(session.login.expiresAt) }}。请在打开的账号网页完成登录和授权。
      </p>
      <template v-if="session.account">
        <p>{{ session.account.displayName }} · 账号 {{ session.account.userId }}</p>
        <p>
          总次数 {{ session.account.trial.limit }} · 已用 {{ session.account.trial.used }} · 占用
          {{ session.account.trial.reserved }} · 剩余 {{ session.account.trial.remaining }}
        </p>
        <p>
          额度到期
          {{
            date(session.account.trial.expiresAt)
          }}；实际调用资格以服务端校验为准，点击刷新可更新显示。
        </p>
        <p v-if="session.account.capabilities">
          当前模型：{{ session.account.capabilities.model }} ·
          {{
            session.account.capabilities.vision
              ? '支持图片输入，仍需开启本店识图'
              : '未获得图片识别能力'
          }}
        </p>
      </template>
      <div class="runtime-actions">
        <el-button
          :disabled="
            !runtime.available ||
            task.pending.value ||
            managed.restartRequired ||
            session.status === 'authorizing'
          "
          @click="action('managed-login')"
          >{{ session.account ? '切换托管账号' : '登录托管账号' }}</el-button
        >
        <el-button
          :disabled="
            !runtime.available ||
            task.pending.value ||
            managed.restartRequired ||
            session.status === 'authorizing'
          "
          @click="action('managed-refresh')"
          >恢复登录 / 刷新额度</el-button
        >
        <el-button
          v-if="session.status === 'authorizing'"
          :disabled="task.pending.value"
          @click="action('managed-cancel-login')"
          >取消登录</el-button
        >
        <el-button
          v-if="session.account || session.status === 'offline'"
          :disabled="task.pending.value"
          @click="action('managed-logout')"
          >退出托管账号</el-button
        >
        <el-button
          :disabled="!runtime.available || task.pending.value || managed.restartRequired"
          @click="action('open-managed-admin')"
          >打开服务端管理后台</el-button
        >
      </div>
      <p>登录凭据只在主进程加密保存；服务商 Key 不下发到桌面。登录、退出和刷新不会自动开启 AI。</p>
    </div>
    <div v-if="runtime.snapshot.modelIssue" class="managed-issue">
      <el-alert :title="runtime.snapshot.modelIssue.message" type="error" :closable="false" />
      <p>请先到服务端用量记录及原会话核对实际结果，清除提示不会重新请求模型或发送回复。</p>
      <p v-if="runtime.snapshot.modelIssue.context?.requestId">
        请求编号：{{ runtime.snapshot.modelIssue.context.requestId }}
      </p>
      <el-checkbox v-model="reviewed">我已核对原请求和处理结果</el-checkbox>
      <el-button :disabled="!reviewed || task.pending.value" @click="acknowledge"
        >清除提示，AI 保持关闭</el-button
      >
    </div>
  </section>
</template>

<style scoped>
.model-source-settings {
  margin-bottom: 24px;
}
.managed-account,
.managed-issue {
  margin-top: 20px;
  padding: 16px;
  border: 1px solid #dce7f5;
  border-radius: 12px;
  background: #f8fbff;
}
.managed-account p,
.model-source-settings > p {
  color: #52647b;
  line-height: 1.7;
}
.runtime-actions {
  flex-wrap: wrap;
}
</style>
