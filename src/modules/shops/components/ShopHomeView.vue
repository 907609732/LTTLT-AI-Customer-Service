<!-- ShopHomeView：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import BrandMark from '@/shared/ui/BrandMark.vue'
const __stub = notifyUnavailable
</script>

<template>
  <div class="shop-home" data-v-8a50ace1="">
    <header class="topbar" data-v-8a50ace1="">
      <BrandMark subtitle="电商AI客服主系统" data-v-8a50ace1=""></BrandMark>
      <nav class="nav" data-v-8a50ace1="">
        <a class="active" href="javascript:void(0)" data-v-8a50ace1="">店铺首页</a
        ><a href="javascript:void(0)" @click="__stub('此操作')" data-v-8a50ace1="">配置中心</a
        ><RouterLink to="/shop/aftersale-warning" data-v-8a50ace1="">售后预警</RouterLink>
      </nav>
      <div class="actions" data-v-8a50ace1="">
        <el-button type="primary" plain="" @click="__stub('此操作')" data-v-8a50ace1=""
          >进入配置</el-button
        ><el-button type="primary" @click="__stub('此操作')" data-v-8a50ace1="">充值</el-button>
      </div>
    </header>
    <main class="hero" data-v-8a50ace1="">
      <div class="hero-copy" data-v-8a50ace1="">
        <p class="kicker" data-v-8a50ace1=""></p>
        <h1 data-v-8a50ace1="">电商AI客服主系统</h1>
        <p class="subtitle" data-v-8a50ace1="">全平台消息聚合 · AI 自动接待 · 人机协同</p>
        <div class="feature-list" data-v-8a50ace1="">
          <template
            :key="entryIndex"
            v-for="(item, entryIndex) in [
              {
                title: '1人管上百家店铺',
                desc: '多店统一接待，聚合管理，降本增效',
                tone: 'people',
              },
              {
                title: '7×24小时秒级AI回复',
                desc: '自动理解话术回复，不错过任何咨询',
                tone: 'bolt',
              },
              { title: '多店防关联', desc: 'IP 隔离，店铺分开登录', tone: 'shield' },
            ]"
            ><article class="feature-card" data-v-8a50ace1="">
              <div :class="['feature-icon', item?.['tone']]" data-v-8a50ace1=""></div>
              <div data-v-8a50ace1="">
                <h3 data-v-8a50ace1="">{{ item?.['title'] }}</h3>
                <p data-v-8a50ace1="">{{ item?.['desc'] }}</p>
              </div>
            </article></template
          >
        </div>
        <div class="cta-row" data-v-8a50ace1="">
          <el-button type="primary" size="large" @click="__stub('此操作')" data-v-8a50ace1=""
            >开始配置店铺</el-button
          ><el-button size="large" @click="__stub('此操作')" data-v-8a50ace1="">查看套餐</el-button>
        </div>
      </div>
      <aside class="hero-side" data-v-8a50ace1="">
        <div class="data-card" data-v-8a50ace1="">
          <h4 data-v-8a50ace1="">今日数据概览</h4>
          <ul data-v-8a50ace1="">
            <template
              :key="entryIndex"
              v-for="(item, entryIndex) in [
                { label: '接待中', value: '128' },
                { label: '未读消息', value: '32' },
                { label: 'AI回复率', value: '98.6%' },
                { label: '满意度', value: '4.9 ★' },
              ]"
              ><li data-v-8a50ace1="">
                <span data-v-8a50ace1="">{{ item?.['label'] }}</span
                ><b data-v-8a50ace1="">{{ item }}</b>
              </li></template
            >
          </ul>
        </div>
        <div class="support" data-v-8a50ace1="">
          <span data-v-8a50ace1="">支持平台</span>
          <div class="plats" data-v-8a50ace1="">
            <template
              :key="entryIndex"
              v-for="(item, entryIndex) in [
                '淘宝',
                '拼多多',
                '抖音',
                '京东',
                '快手',
                '小红书',
                '视频号',
              ]"
              ><em data-v-8a50ace1="">{{ item }}</em></template
            >
          </div>
        </div>
      </aside>
    </main>
    <footer class="footer" data-v-8a50ace1="">
      <span data-v-8a50ace1="">yktai.com</span><span data-v-8a50ace1="">加密通道已启用</span
      ><span data-v-8a50ace1="">本页为 Vue 营销落地简化版</span>
    </footer>
  </div>
</template>
