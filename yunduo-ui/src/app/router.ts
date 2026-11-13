import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

/**
 * 路由表按原始应用还原（hash 模式，便于 Electron file:// 直接加载）
 * 所有页面均可直接访问：本工程只还原 UI，不做登录态校验。
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/logs',
    name: 'runtime-logs',
    component: () => import('@/modules/auxiliary').then((m) => m.RuntimeLogsView),
    meta: { title: '实时日志', float: true },
  },
  {
    path: '/login',
    name: 'login',
    component: /* lazy module entry */ () => import('@/modules/account').then((m) => m.LoginView),
    meta: { public: true, title: '登录' },
  },
  { path: '/float/messages', redirect: { name: 'float-assist' } },
  {
    path: '/float/assist',
    name: 'float-assist',
    component: /* lazy module entry */ () =>
      import('@/modules/auxiliary').then((m) => m.AiAssistCenterView),
    props: { visible: true, standalone: true },
    meta: { title: 'AI辅助中心', float: true },
  },
  {
    path: '/float/mascot',
    name: 'float-mascot',
    component: /* lazy module entry */ () =>
      import('@/modules/auxiliary').then((m) => m.MascotFloatView),
    meta: { title: '云朵助手', float: true },
  },
  {
    path: '/sim',
    name: 'sim-console',
    component: /* lazy module entry */ () =>
      import('@/modules/simulation').then((m) => m.SimConsoleView),
    meta: { title: '模拟客服台' },
  },
  {
    path: '/shop/manage',
    name: 'shop-manage',
    component: () => import('@/app/layouts/ShopManageView.vue'),
    meta: { public: true, title: '配置中心', shop: true },
  },
  {
    path: '/shop/recharge',
    name: 'shop-recharge',
    component: /* lazy module entry */ () =>
      import('@/modules/billing').then((m) => m.ShopRechargeView),
    meta: { public: true, title: '充值选购', shop: true },
  },
  {
    path: '/shop/login',
    name: 'shop-login',
    component: /* lazy module entry */ () => import('@/modules/account').then((m) => m.LoginView),
    meta: { public: true, title: '登录', shop: true },
  },
  {
    path: '/shop/forgot-password',
    name: 'shop-forgot-password',
    component: /* lazy module entry */ () =>
      import('@/modules/account').then((m) => m.ShopForgotPasswordView),
    meta: { public: true, title: '忘记密码', shop: true },
  },
  {
    path: '/shop/home',
    name: 'shop-home',
    component: /* lazy module entry */ () => import('@/modules/shops').then((m) => m.ShopHomeView),
    meta: { public: true, title: '店铺首页', shop: true },
  },
  {
    path: '/shop/aftersale-warning',
    name: 'shop-aftersale-warning',
    component: /* lazy module entry */ () =>
      import('@/modules/quality').then((m) => m.ShopAftersaleWarningView),
    meta: { public: true, title: '售后预警', shop: true },
  },
  {
    path: '/hub',
    name: 'backend-hub',
    component: /* lazy module entry */ () =>
      import('@/modules/auxiliary').then((m) => m.BackendHubView),
    meta: { public: true, title: '商家后台聚合', hub: true },
  },
  {
    path: '/snap-overlay',
    name: 'snap-overlay',
    component: /* lazy module entry */ () =>
      import('@/modules/auxiliary').then((m) => m.SnapOverlayView),
    meta: { public: true, title: '弹层', overlay: true },
  },
  {
    path: '/',
    component: () => import('@/app/layouts/MainLayout.vue'),
    children: [
      {
        path: '',
        name: 'dashboard',
        component: /* lazy module entry */ () =>
          import('@/modules/workbench').then((m) => m.DashboardView),
        meta: { title: '工作台' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: /* lazy module entry */ () =>
          import('@/modules/settings').then((m) => m.SettingsView),
        meta: { title: '设置' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.afterEach((to) => {
  const title = to.meta?.title
  if (title) document.title = `${title} · 云朵客服`
})

export default router
