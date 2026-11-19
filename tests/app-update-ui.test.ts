import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UpdateStatus from '../src/shared/ui/UpdateStatus.vue'

const desktop = vi.hoisted(() => ({
  isElectron: true,
  checkForUpdates: vi.fn(),
  openExternal: vi.fn(),
}))
vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => desktop }))
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.resetAllMocks()
})
it('启动检查一次，发现新版在左下提示，点击才打开下载页', async () => {
  desktop.checkForUpdates.mockResolvedValue({
    status: 'available',
    latestVersion: '1.0.75',
    releaseUrl: 'https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.75',
  })
  const wrapper = mount(UpdateStatus)
  wrappers.push(wrapper)
  await flushPromises()
  expect(desktop.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(desktop.checkForUpdates).toHaveBeenCalledWith(false)
  expect(wrapper.get('[role="status"]').text()).toContain('发现新版本 v1.0.75')
  expect(desktop.openExternal).not.toHaveBeenCalled()
  await wrapper.get('[data-update-download]').trigger('click')
  expect(desktop.openExternal).toHaveBeenCalledWith(
    'https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.75',
  )
  await wrapper.get('[aria-label="稍后更新"]').trigger('click')
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
})
it('检查失败不会报告最新版，可手动重试，当前版本不自动弹窗', async () => {
  desktop.checkForUpdates
    .mockRejectedValueOnce(Error('network'))
    .mockResolvedValueOnce({ status: 'current' })
  const wrapper = mount(UpdateStatus)
  wrappers.push(wrapper)
  await flushPromises()
  expect(wrapper.text()).toContain('检查失败，点击重试')
  await wrapper.get('button').trigger('click')
  await flushPromises()
  expect(desktop.checkForUpdates).toHaveBeenLastCalledWith(true)
  expect(wrapper.text()).toContain('已是最新版本')
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
})
it('请求进行时禁用按钮，防止重复请求', async () => {
  desktop.checkForUpdates.mockReturnValue(new Promise(() => {}))
  const wrapper = mount(UpdateStatus)
  wrappers.push(wrapper)
  await flushPromises()
  expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('正在检查更新')
})
