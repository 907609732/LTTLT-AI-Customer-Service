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
it('版本旁小按钮保留检查失败重试和新版详情，长状态通过标题完整显示', async () => {
  desktop.checkForUpdates.mockRejectedValueOnce(Error('network')).mockResolvedValueOnce({
    status: 'available',
    latestVersion: '9.0.0',
    releaseUrl: 'https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v9.0.0',
  })
  const wrapper = mount(UpdateStatus, { props: { variant: 'footer', compact: true } })
  wrappers.push(wrapper)
  await flushPromises()
  const button = wrapper.get('.app-update-check')
  expect(button.text()).toBe('重试更新')
  expect(button.attributes('title')).toBe('检查失败，点击重试')
  await button.trigger('click')
  await flushPromises()
  expect(desktop.checkForUpdates).toHaveBeenLastCalledWith(true)
  expect(button.text()).toBe('有新版本')
  expect(button.attributes('aria-label')).toBe('发现新版本 v9.0.0')
  expect(wrapper.get('[role="status"]').text()).toContain('发现新版本 v9.0.0')
})

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
it('footer 变体保留原提示与重试，并在按钮上突出具体新版本', async () => {
  desktop.checkForUpdates.mockResolvedValue({
    status: 'available',
    latestVersion: '1.0.92',
    releaseUrl: 'https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.92',
  })
  const wrapper = mount(UpdateStatus, { props: { variant: 'footer' } })
  wrappers.push(wrapper)
  await flushPromises()
  expect(wrapper.get('.app-update').classes()).toContain('app-update--footer')
  expect(wrapper.get('.app-update-check').text()).toContain('发现新版本 v1.0.92')
  expect(wrapper.get('[role="status"]').text()).toContain('发现新版本 v1.0.92')
  expect(wrapper.get('[role="status"]').find('[aria-label="稍后更新"]').exists()).toBe(true)
  expect(wrapper.get('.app-update-icon path').attributes('d')).toContain('M771.776 794.88')
  desktop.openExternal.mockRejectedValueOnce(Error('open failed'))
  await wrapper.get('[data-update-download]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('无法打开下载页，请重试')
})
it('已缓存可用版本后手动检查失败仍显示失败，重试成功再恢复结果', async () => {
  desktop.checkForUpdates
    .mockResolvedValueOnce({
      status: 'available',
      latestVersion: '1.0.92',
      releaseUrl: 'https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.92',
    })
    .mockRejectedValueOnce(Error('network down'))
    .mockResolvedValueOnce({ status: 'current', latestVersion: '1.0.92', releaseUrl: null })
  const wrapper = mount(UpdateStatus, { props: { variant: 'footer' } })
  wrappers.push(wrapper)
  await flushPromises()
  expect(wrapper.get('.app-update-check').text()).toContain('发现新版本 v1.0.92')
  await wrapper.get('.app-update-check').trigger('click')
  await flushPromises()
  expect(wrapper.get('.app-update-check').text()).toContain('检查失败，点击重试')
  expect(wrapper.get('.app-update-check').classes()).not.toContain('has-update')
  expect(wrapper.get('[role="status"]').text()).toContain('发现新版本 v1.0.92')
  await wrapper.get('.app-update-check').trigger('click')
  await flushPromises()
  expect(wrapper.get('.app-update-check').text()).toContain('已是最新版本')
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
  expect(desktop.checkForUpdates).toHaveBeenLastCalledWith(true)
})
