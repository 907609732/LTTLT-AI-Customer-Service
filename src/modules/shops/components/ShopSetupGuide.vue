<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useShopSetupStore } from '../setup-store'
const setup = useShopSetupStore(),
  router = useRouter(),
  route = useRoute()
const steps = ['连接店铺', '配置知识', '接待与试答']
async function configure(panel: string) {
  const target = setup.storeId
  setup.pauseForConfiguration()
  try {
    await router.push(
      panel === 'model-settings'
        ? { path: '/settings' }
        : { path: '/shop/manage', query: { panel } },
    )
  } catch (cause) {
    if (target && setup.storeId === target) {
      setup.error = cause instanceof Error ? cause.message : String(cause)
      setup.resume()
    }
  }
}
function connect() {
  void setup.connect(async () => {
    await router.push('/')
  })
}
function updateVisible(visible: boolean) {
  // Element Plus 在程序收起后的过渡结束也回传 false；保留配置/登录的继续租约。
  if (!visible && setup.visible) setup.dismiss()
}
</script>
<template>
  <el-button
    v-if="setup.returnAvailable && !setup.visible && route.path !== '/'"
    class="shop-setup-resume"
    type="primary"
    @click="setup.resume()"
    >继续基础设置</el-button
  >
  <el-dialog
    :model-value="setup.visible"
    width="650px"
    class="shop-setup-guide"
    align-center
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="updateVisible"
  >
    <template #header
      ><strong>基础设置</strong
      ><span class="shop-setup-name">{{ setup.shop?.storeName }}</span></template
    >
    <el-steps :active="setup.step" simple
      ><el-step v-for="label in steps" :key="label" :title="label"
    /></el-steps>
    <section v-if="setup.step === 0" class="shop-setup-content">
      <h3>先连接您的店铺</h3>
      <p>在平台登录页完成扫码或登录。只有检测到店铺在线，才会显示已连接。</p>
      <el-tag :type="setup.shop?.runtime.online ? 'success' : 'info'">{{
        setup.shop?.runtime.online ? '已连接' : '尚未连接'
      }}</el-tag>
      <el-button type="primary" :loading="setup.pending" @click="connect">打开店铺登录</el-button>
    </section>
    <section v-else-if="setup.step === 1" class="shop-setup-content">
      <h3>让 AI 熟悉本店商品与问答</h3>
      <p>采集或新增商品知识，核对商品详情及不同规格后再启用。常见问题可在意图问法中补充。</p>
      <div class="shop-setup-options">
        <button @click="configure('goods')">
          <strong>商品知识</strong><span>采集商品、核对 SKU、审核并启用知识</span></button
        ><button @click="configure('intent')">
          <strong>常见问题与回答</strong><span>维护售前售后问答，绑定本店知识</span>
        </button>
      </div>
      <p class="shop-setup-note">进入配置页不代表配置完成；请以页面实际保存和启用状态为准。</p>
    </section>
    <section v-else class="shop-setup-content">
      <h3>配置接待规则，再做试答</h3>
      <p>按本店需要设置模型、欢迎语及转接规则，然后在训练场核对回复。</p>
      <div class="shop-setup-options">
        <button @click="configure('model-settings')">
          <strong>模型连接设置</strong><span>检查模型服务与 API Key</span></button
        ><button @click="configure('aicustom')">
          <strong>店铺回复要求</strong><span>设置本店专用回复规则</span></button
        ><button @click="configure('welcome')">
          <strong>进店欢迎</strong><span>配置本店欢迎内容</span></button
        ><button @click="configure('transfer')">
          <strong>人工转接</strong><span>核对本店转接规则</span></button
        ><button @click="configure('training')">
          <strong>AI 训练场</strong><span>测试不同商品规格和常见问题</span>
        </button>
      </div>
      <p class="shop-setup-note">
        完成引导不会自动开启 AI；试答可能使用您已配置的模型服务。正式发送仍需逐条批准。
      </p>
    </section>
    <el-alert v-if="setup.error" :title="setup.error" type="error" :closable="false" />
    <template #footer
      ><el-button @click="setup.dismiss()">稍后配置</el-button
      ><el-button v-if="setup.step > 0" @click="setup.step--">上一步</el-button
      ><el-button v-if="setup.step < 2" type="primary" @click="setup.step++">下一步</el-button
      ><el-button v-else type="primary" @click="setup.finish()">完成引导</el-button></template
    >
  </el-dialog>
</template>
<style scoped>
.shop-setup-name {
  margin-left: 14px;
  color: #7183a0;
  font-size: 13px;
}
.shop-setup-content {
  padding: 20px 0;
  min-height: 230px;
}
.shop-setup-content h3 {
  color: #263954;
  font-size: 18px;
}
.shop-setup-content p {
  color: #7183a0;
  line-height: 1.8;
}
.shop-setup-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 20px;
}
.shop-setup-options button {
  text-align: left;
  border: 1px solid #d7e5fb;
  border-radius: 10px;
  padding: 16px;
  background: #f8fbff;
  cursor: pointer;
  color: #263954;
}
.shop-setup-options button:hover {
  border-color: #4088ff;
  background: #edf5ff;
}
.shop-setup-options strong,
.shop-setup-options span {
  display: block;
}
.shop-setup-options span {
  margin-top: 8px;
  color: #7183a0;
  font-size: 12px;
}
.shop-setup-note {
  font-size: 12px;
}
.shop-setup-resume {
  position: fixed;
  right: 30px;
  bottom: 24px;
  z-index: 1800;
  box-shadow: 0 4px 16px #3377ff30;
}
</style>
