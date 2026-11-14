<!-- DashboardView：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { useServices } from '@/shared/contracts/services'
import { AddShopDialog } from '@/modules/shops'
import { notifyUnavailable } from '@/shared/ui/feedback'
import { useRouter } from 'vue-router'
import IconPlus from '@/shared/icons/IconPlus.vue'
import IconMonitor from '@/shared/icons/IconMonitor.vue'
import IconShop from '@/shared/icons/IconShop.vue'
import IconService from '@/shared/icons/IconService.vue'
import IconChatDotRound from '@/shared/icons/IconChatDotRound.vue'
import IconCopyDocument from '@/shared/icons/IconCopyDocument.vue'
import BrandMark from '@/shared/ui/BrandMark.vue'
import ContactQrTrigger from '@/shared/ui/ContactQrTrigger.vue'
import asset_platform_taobao_BMeB5Sjo from '@/assets/platform-taobao-BMeB5Sjo.png'
import asset_platform_pdd_jnRpGwzN from '@/assets/platform-pdd-jnRpGwzN.png'
import asset_platform_doudian_Cyz3XQnL from '@/assets/platform-doudian-Cyz3XQnL.png'
import asset_platform_qianniu_OMJUdj6j from '@/assets/platform-qianniu-OMJUdj6j.png'
import asset_platform_jd_DgPnlapk from '@/assets/platform-jd-DgPnlapk.png'
import asset_platform_kuaishou_CVcuqyaE from '@/assets/platform-kuaishou-CVcuqyaE.png'
import asset_platform_wechat_DKPVTB1A from '@/assets/platform-wechat-DKPVTB1A.png'
import asset_platform_qianfan_Nuo9E5_N from '@/assets/platform-qianfan-Nuo9E5-N.png'
import asset_platform_xianyu_CkI7OnrT from '@/assets/platform-xianyu-CkI7OnrT.png'
import { ref, computed } from 'vue'
import { createDashboardViewDemo } from '@/modules/workbench/demo/DashboardView'
import { getDesktop } from '@/shared/platform/desktop'
import { useTask } from '@/shared/ui/use-task'
const demo = createDashboardViewDemo()
const router = useRouter()
const addingShop = ref(false)
const __stub = notifyUnavailable
const isDiv = ref(demo.isDiv)
const isDivState = ref(demo.isDivState)
const services = useServices()
const title = computed(() => services.workbench.getWelcome())
const homeBizWechat = ref(demo.homeBizWechat)
const assistTask = useTask()
async function openAssist() {
  const desktop = getDesktop()
  if (!desktop.isElectron) {
    await router.push('/float/assist')
    return
  }
  const ok = await assistTask.run(async () => {
    if (!desktop.openAssist) throw new Error('辅助中心窗口尚未接入，请更新桌面程序')
    await desktop.openAssist()
  })
  if (!ok) notifyUnavailable(assistTask.error.value)
}
</script>

<template>
  <section class="store-home" data-v-8cdf7e6d="">
    <div
      :class="['home-stage home-stage--empty', { 'is-mascot-menu-open': isDiv && !isDivState }]"
      data-v-8cdf7e6d=""
    >
      <div class="home-empty-glow" aria-hidden="true" data-v-8cdf7e6d=""></div>
      <div
        class="home-empty-glow home-empty-glow--right"
        aria-hidden="true"
        data-v-8cdf7e6d=""
      ></div>
      <!--v-if-->
      <div class="home-empty-main" data-v-8cdf7e6d="">
        <div class="home-brand-whisper" data-v-8cdf7e6d="">
          <BrandMark
            size="sm"
            subtitle="电商AI客服主系统 · 全平台消息聚合"
            data-v-8cdf7e6d=""
          ></BrandMark>
        </div>
        <div class="home-empty-hero" data-v-8cdf7e6d="">
          <h1 data-v-8cdf7e6d="">{{ title?.['title'] }}</h1>
          <p data-v-8cdf7e6d="">{{ title?.['desc'] }}</p>
          <button
            type="button"
            :class="['home-add-store-btn', { 'is-emphasis': title?.['mode'] === 'empty' }]"
            @click="addingShop = true"
            data-v-8cdf7e6d=""
          >
            <el-icon data-v-8cdf7e6d=""
              ><component :is="IconPlus" data-v-8cdf7e6d=""></component></el-icon
            >{{ ' ' + (title?.['mode'] === 'empty' ? '立即添加店铺' : '添加店铺') }}</button
          ><template v-if="title?.['offline'] > 0"
            ><button
              type="button"
              class="home-offline-chip"
              @click="__stub('此操作')"
              data-v-8cdf7e6d=""
            ></button
          ></template>
        </div>
        <div class="home-empty-actions" data-v-8cdf7e6d="">
          <template
            :key="entryIndex"
            v-for="(item, entryIndex) in [
              {
                key: 'assist',
                title: '打开AI辅助中心',
                desc: '咨询回复 · 预警 / 工单 / 售后',
                icon: IconMonitor,
                run: () => __stub('此操作'),
              },
              {
                key: 'shop-manage',
                title: '配置中心',
                desc: '登录店铺、知识库与接待配置',
                icon: IconShop,
                run: () => __stub('此操作'),
              },
            ]"
            ><button
              type="button"
              class="home-action-card"
              data-nav
              @click="item?.key === 'assist' ? openAssist() : router.push('/shop/manage')"
              data-v-8cdf7e6d=""
            >
              <span class="home-action-icon" data-v-8cdf7e6d=""
                ><el-icon data-v-8cdf7e6d=""
                  ><component :is="item?.['icon']" data-v-8cdf7e6d=""></component></el-icon></span
              ><strong data-v-8cdf7e6d="">{{ item?.['title'] }}</strong
              ><span data-v-8cdf7e6d="">{{ item?.['desc'] }}</span>
            </button></template
          >
        </div>
        <div class="home-product-panel" data-v-8cdf7e6d="">
          <div class="home-product-links" data-v-8cdf7e6d="">
            <template
              :key="entryIndex"
              v-for="(item, entryIndex) in [
                {
                  key: 'aftersale',
                  title: '售后系统',
                  desc: '自动退款、工单分流、物流拦截',
                  url: 'https://yktai.com/aftersales.html',
                  icon: IconService,
                },
                {
                  key: 'private',
                  title: '私域系统',
                  desc: '全渠道接待、意向识别、顾问协同',
                  url: 'https://yktai.com/private-domain.html',
                  icon: IconChatDotRound,
                },
              ]"
              ><button
                type="button"
                class="home-product-card"
                @click="__stub(item?.title || '了解产品')"
                data-v-8cdf7e6d=""
              >
                <span class="home-product-icon" data-v-8cdf7e6d=""
                  ><el-icon data-v-8cdf7e6d=""
                    ><component :is="item?.['icon']" data-v-8cdf7e6d=""></component></el-icon></span
                ><span class="home-product-copy" data-v-8cdf7e6d=""
                  ><strong data-v-8cdf7e6d="">{{ item?.['title'] }}</strong
                  ><em data-v-8cdf7e6d="">{{ item?.['desc'] }}</em></span
                >
              </button></template
            >
          </div>
          <template v-if="false"
            ><button
              type="button"
              class="home-biz-wechat"
              title="点击复制微信号"
              @click="__stub('此操作')"
              data-v-8cdf7e6d=""
            >
              <span data-v-8cdf7e6d=""
                >商务合作微信：<b data-v-8cdf7e6d="">{{ homeBizWechat?.['wechat'] }}</b></span
              ><el-icon data-v-8cdf7e6d=""
                ><component :is="IconCopyDocument" data-v-8cdf7e6d=""></component
              ></el-icon></button></template
          ><template v-else
            ><ContactQrTrigger
              class="home-contact-qr"
              text="商务合作"
              data-v-8cdf7e6d=""
            ></ContactQrTrigger
          ></template>
        </div>
      </div>
      <footer class="home-empty-footer" data-v-8cdf7e6d="">
        <div class="home-platform-row" data-v-8cdf7e6d="">
          <template
            :key="entryIndex"
            v-for="(item, entryIndex) in [
              { name: '淘宝', icon: asset_platform_taobao_BMeB5Sjo },
              { name: '拼多多', icon: asset_platform_pdd_jnRpGwzN },
              { name: '抖店', icon: asset_platform_doudian_Cyz3XQnL },
              { name: '千牛', icon: asset_platform_qianniu_OMJUdj6j },
              { name: '京东', icon: asset_platform_jd_DgPnlapk },
              { name: '快手', icon: asset_platform_kuaishou_CVcuqyaE },
              { name: '微信', icon: asset_platform_wechat_DKPVTB1A },
              { name: '千帆', icon: asset_platform_qianfan_Nuo9E5_N },
              { name: '闲鱼', icon: asset_platform_xianyu_CkI7OnrT },
            ]"
            ><span class="home-platform-pill" :title="item?.['name']" data-v-8cdf7e6d=""
              ><img :src="item?.['icon']" :alt="item?.['name']" data-v-8cdf7e6d="" />{{
                ' ' + item?.['name']
              }}</span
            ></template
          >
        </div>
        <p class="home-empty-footnote" data-v-8cdf7e6d="">已支持主流电商平台</p>
      </footer>
    </div>
  </section>
  <AddShopDialog v-model="addingShop" />
</template>
