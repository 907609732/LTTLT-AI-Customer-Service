import { expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises } from '@vue/test-utils'
import { installKnowledgeNavigation } from '../src/app/knowledge-navigation'
import type { KnowledgeBridge } from '../src/shared/contracts/knowledge-client'
import { routes } from '../src/app/router'

it('知识库路由复用主布局且传入嵌入模式', () => {
  const parent = routes.find((route) => route.path === '/')!
  const knowledge = parent.children!.find((route) => route.path === 'knowledge')!
  expect(knowledge.props).toEqual({ embedded: true })
  expect(knowledge.meta?.float).not.toBe(true)
  expect(routes.some((route) => route.path === '/knowledge')).toBe(false)
})
it('固定事件只导航主内容区，忽略旧账号与迟到事件，关闭事件不打断其他页面', async () => {
  let listener!: Parameters<NonNullable<KnowledgeBridge['onNavigate']>>[0]
  const off = vi.fn()
  const bridge = {
    onNavigate: (next: typeof listener) => {
      listener = next
      return off
    },
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: {} },
      { path: '/knowledge', name: 'knowledge-manager', component: {} },
      { path: '/shop/manage', component: {} },
    ],
  })
  await router.push('/')
  const runtime = { snapshot: { workspaceId: 'w' }, refresh: vi.fn(async () => {}) }
  const report = vi.fn()
  const dispose = installKnowledgeNavigation(bridge, router, runtime, report)
  listener({ workspaceId: 'w', target: 'library' })
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/knowledge')
  listener({ workspaceId: 'old', target: 'home' })
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/knowledge')
  listener({ workspaceId: 'w', target: 'home' })
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/')
  await router.push('/shop/manage')
  listener({ workspaceId: 'w', target: 'home' })
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/shop/manage')
  let done!: () => void
  runtime.refresh.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve
      }),
  )
  listener({ workspaceId: 'other', target: 'library' })
  dispose()
  done()
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/shop/manage')
  expect(off).toHaveBeenCalledOnce()
  expect(report).not.toHaveBeenCalled()
})
