<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useShopSetupStore } from '../setup-store'
const setup = useShopSetupStore(),
  runtime = useRuntimeStore(),
  router = useRouter()
const steps = [
  '登录',
  '导入商品与学习',
  '客服风格',
  '物流与发货',
  '接待设置',
  '售后政策',
  '确认信息',
  '完成',
]
const showing = computed(() => Boolean(setup.onboardingPhase && !setup.returnAvailable))
const importing = computed(() => setup.onboarding)
let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
watch(
  () =>
    [
      setup.onboarding.jobId,
      setup.storeId,
      setup.onboarding.activeJob,
      setup.onboarding.error,
    ] as const,
  () => {
    const owner = ++generation
    clearTimeout(timer)
    async function poll() {
      if (owner !== generation || !importing.value.activeJob) return
      await importing.value.refreshJob()
      if (owner === generation && importing.value.activeJob && !importing.value.error)
        timer = setTimeout(() => void poll(), 2000)
    }
    if (setup.onboarding.jobId && setup.onboarding.activeJob && !setup.onboarding.error) void poll()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation++
  clearTimeout(timer)
})
async function leave() {
  if (importing.value.busy || setup.pending || setup.saving) return
  if (importing.value.activeJob) {
    try {
      await ElMessageBox.confirm('当前任务将继续在后台执行，可从知识库查看。', '退出引导', {
        confirmButtonText: '后台执行并退出',
        cancelButtonText: '留在引导',
        customClass: 'onboarding-exit-box',
      })
    } catch {
      return
    }
  }
  setup.dismiss()
}
async function finish() {
  setup.finish()
  runtime.platformStoreId = ''
  await router.push('/')
}
</script>
<template>
  <section v-if="showing" class="new-store-header" aria-label="新店铺引导">
    <div class="new-store-title">
      <strong
        >{{ setup.shop?.storeName || '添加店铺' }}
        <small>{{ setup.onboardingImportNote }}</small></strong
      ><button :disabled="setup.pending || importing.busy || setup.saving" @click="leave">
        稍后继续
      </button>
    </div>
    <ol class="new-store-steps">
      <li
        v-for="(label, index) in steps"
        :key="label"
        :class="{ current: setup.onboardingIndex === index, done: setup.onboardingIndex > index }"
        :aria-current="setup.onboardingIndex === index ? 'step' : undefined"
      >
        <span>{{
          index === 1 && setup.onboardingImportNote.includes('稍后')
            ? '—'
            : setup.onboardingIndex > index
              ? '✓'
              : index + 1
        }}</span
        >{{ label }}
      </li>
    </ol>
    <div v-if="setup.onboardingPhase === 'login'" class="login-confirm">
      <span>请在下方完成平台登录</span
      ><el-button type="primary" :loading="setup.pending" @click="setup.confirmLogin"
        >我已登录</el-button
      ><span v-if="setup.error" role="alert">{{ setup.error }}</span>
    </div>
  </section>
  <section
    v-if="showing && setup.onboardingPhase === 'import'"
    class="new-store-content"
    aria-label="导入商品与学习"
  >
    <h1>导入商品与学习</h1>
    <p v-if="setup.shop?.platform !== 'pdd-web'">
      此平台暂不支持自动导入，可选择资料文件或稍后导入。
    </p>
    <el-alert
      v-if="importing.submissionUnknown"
      title="任务提交结果未确认，请到知识库核对，勿重复提交。"
      type="warning"
      :closable="false"
    />
    <template v-if="!importing.jobId && !importing.submissionUnknown">
      <el-button
        v-if="setup.shop?.platform === 'pdd-web'"
        :loading="importing.busy"
        @click="importing.loadCatalog"
        >读取在售商品</el-button
      >
      <el-button :disabled="importing.busy" @click="importing.chooseFiles">选择资料文件</el-button>
      <div v-if="importing.catalog" class="import-selection">
        <p>{{ importing.catalog.range }} · 已选择 {{ importing.selected.length }} 件</p>
        <el-checkbox-group v-model="importing.selected"
          ><el-checkbox
            v-for="item in importing.catalog.items"
            :key="item.productId"
            :value="item.productId"
            >{{ item.title }}</el-checkbox
          ></el-checkbox-group
        ><el-button
          type="primary"
          :disabled="!importing.selected.length || importing.busy"
          @click="importing.startImport('collect')"
          >确认导入商品</el-button
        >
      </div>
      <div v-if="importing.preview" class="import-selection">
        <p>
          预览：{{ importing.preview.files }} 个文件，{{ importing.preview.parts }} 段资料，{{
            importing.preview.duplicates
          }}
          段重复
        </p>
        <p v-for="warning in importing.preview.warnings" :key="warning">{{ warning }}</p>
        <ul>
          <li v-for="(row, index) in importing.preview.rows.slice(0, 20)" :key="index">
            {{ row.label }} · {{ row.target }}：{{ row.text.slice(0, 160) }}
          </li>
        </ul>
        <el-button
          type="primary"
          :disabled="importing.busy"
          @click="importing.startImport('import')"
          >确认导入资料</el-button
        >
      </div>
    </template>
    <div v-if="importing.jobId" class="import-progress" aria-live="polite">
      <h2>{{ importing.job?.kind === 'learn' ? '模型学习' : '资料导入' }}</h2>
      <el-progress v-if="importing.percent !== null" :percentage="importing.percent" />
      <p v-else>{{ importing.activeJob ? '正在处理，请稍候…' : '处理已结束' }}</p>
      <p v-if="importing.job">
        已处理 {{ importing.job.progress.completed }} /
        {{ importing.job.progress.total ?? '总数待确认' }}
      </p>
      <el-button :disabled="importing.busy" @click="importing.refreshJob">刷新进度</el-button>
      <el-button
        v-if="importing.activeJob || importing.job?.status === 'paused'"
        :disabled="importing.busy"
        @click="importing.cancel"
        >取消任务</el-button
      >
    </div>
    <p v-if="importing.notice" role="status">{{ importing.notice }}</p>
    <el-alert v-if="importing.error" :title="importing.error" type="error" :closable="false" />
    <el-button
      v-if="importing.imported && importing.job?.kind !== 'learn' && !importing.estimate"
      :disabled="importing.busy"
      @click="importing.estimateLearning"
      >估算本次资料学习</el-button
    >
    <div v-if="importing.estimate" class="import-selection">
      <h2>确认模型学习</h2>
      <p>
        {{ importing.estimate.sources }} 份资料 · {{ importing.estimate.images }} 张图片 · 预计
        {{ importing.estimate.estimatedTokens }} tokens
      </p>
      <p>{{ importing.estimate.message }}</p>
      <p>学习会消耗模型调用额度，结果需审核后才能用于接待。</p>
      <el-button
        type="primary"
        :disabled="importing.busy || importing.submissionUnknown"
        @click="importing.startLearning"
        >确认开始学习</el-button
      >
    </div>
    <footer>
      <el-button
        :disabled="importing.busy"
        type="primary"
        @click="setup.startOnboardingSettings(importing.activeJob)"
        >{{
          importing.activeJob
            ? '后台执行并继续设置'
            : importing.imported
              ? '开始设置'
              : '稍后导入，开始设置'
        }}</el-button
      >
    </footer>
  </section>
  <section
    v-if="showing && setup.onboardingPhase === 'complete'"
    class="new-store-content complete"
    aria-label="新店铺设置完成"
  >
    <h1>设置完成</h1>
    <p>本店客服设置已保存。</p>
    <el-button type="primary" @click="finish">返回店铺首页</el-button>
  </section>
</template>
<style scoped>
:global(.el-overlay:has(.onboarding-exit-box)) {
  z-index: 6000 !important;
}
.new-store-header {
  position: absolute;
  left: 300px;
  right: 0;
  top: 72px;
  height: 144px;
  box-sizing: border-box;
  padding: 8px 20px;
  background: #fff;
  border-bottom: 1px solid #dce5f4;
  z-index: 5000;
  overflow: hidden;
}
.new-store-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 24px;
}
.new-store-title button {
  border: 0;
  background: transparent;
  color: #53729c;
  cursor: pointer;
}
.new-store-steps {
  display: flex;
  gap: 10px;
  list-style: none;
  padding: 6px 0;
  margin: 0;
  overflow-x: auto;
  white-space: nowrap;
}
.new-store-steps li {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #8291a8;
  font-size: 12px;
}
.new-store-steps li span {
  border-radius: 50%;
  background: #eef2f7;
  min-width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
}
.new-store-steps .current {
  color: #2763eb;
  font-weight: 600;
}
.new-store-steps .current span {
  background: #2763eb;
  color: white;
}
.new-store-steps .done {
  color: #159c6b;
}
.login-confirm {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 13px;
  height: 44px;
}
.login-confirm [role='alert'] {
  color: #c53636;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.new-store-content {
  position: absolute;
  inset: 216px 0 0 300px;
  background: #f7f9fd;
  z-index: 4001;
  padding: 30px;
  overflow: auto;
  box-sizing: border-box;
}
.import-selection,
.import-progress {
  margin: 18px 0;
  padding: 20px;
  border: 1px solid #dce5f4;
  border-radius: 12px;
  background: white;
}
.import-selection :deep(.el-checkbox-group) {
  max-height: 240px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.import-selection li {
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.new-store-content footer {
  margin-top: 30px;
}
.complete {
  text-align: center;
  padding-top: 100px;
}
</style>
