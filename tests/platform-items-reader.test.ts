import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { createAssistPlatformReader } from '../electron/assist-platform-reader'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
const store = { id: 'store-a', platform: 'pdd-web', storeName: '测试店', identityId: 'mall-a' }
function fixture(url = 'https://mms.pinduoduo.com/aftersales/work_order/list') {
  const identityScript = vi.fn(
    () => '({ authenticated: true, mallId: "mall-a", storeName: "测试店" })',
  )
  const executeJavaScript = vi.fn(
    async (script: string): Promise<unknown> => new Function(`return ${script}`)(),
  )
  const page = { getURL: () => url, executeJavaScript } as unknown as Pick<
    WebContents,
    'getURL' | 'executeJavaScript'
  >
  const read = createAssistPlatformReader({
    page: () => page,
    collectionPage: async () => page,
    identityScript,
    refreshQuery: async () => {},
    turnPage: async () => {},
  })
  return { read, executeJavaScript, identityScript }
}
describe('平台页面只读边界', () => {
  it('本轮抖店明确未接入，不读取后台或要求登录后假装可同步', async () => {
    const f = fixture('https://fxg.jinritemai.com/')
    const result = await f.read({ ...store, platform: 'doudian-client' }, 'ticket')
    expect(result.message).toContain('尚未接入')
    expect(f.executeJavaScript).not.toHaveBeenCalled()
  })
  it('先检查实页验证码，不能把遮罩背后的表格当已成功读取', async () => {
    document.body.innerHTML =
      '<div role="dialog">请向右滑块完成拼图</div><table><tr><td>0</td></tr></table>'
    vi.spyOn(document.querySelector('[role="dialog"]')!, 'getClientRects').mockReturnValue([
      new DOMRect(10, 10, 200, 40),
    ] as unknown as DOMRectList)
    const f = fixture()
    const result = await f.read(store, 'ticket')
    expect(result).toMatchObject({ authenticated: null, recognized: false, total: null, items: [] })
    expect(result.message).toContain('人工验证')
    expect(f.identityScript).not.toHaveBeenCalled()
  })
  it('验证完成后残留隐藏验证码文字不误报需验证', async () => {
    document.body.innerHTML = '<div style="display:none"><span>请向右滑块完成拼图</span></div>'
    vi.spyOn(document.querySelector('span')!, 'getClientRects').mockReturnValue([
      new DOMRect(10, 10, 200, 40),
    ] as unknown as DOMRectList)
    const f = fixture()
    const result = await f.read(store, 'ticket')
    expect(result.message).not.toContain('人工验证')
    expect(f.identityScript).toHaveBeenCalled()
  })
  it('已登录且身份可读也不把未知列表结构或空DOM标成0', async () => {
    const f = fixture()
    const result = await f.read(store, 'ticket')
    expect(result).toMatchObject({
      authenticated: true,
      identityId: 'mall-a',
      identityName: '测试店',
      recognized: false,
      total: null,
    })
  })
  it('登录过期不读账户/列表，错误来源不执行脚本', async () => {
    const login = fixture('https://mms.pinduoduo.com/login/')
    expect(await login.read(store, 'ticket')).toMatchObject({
      authenticated: false,
      recognized: false,
      total: null,
    })
    expect(login.identityScript).not.toHaveBeenCalled()
    const wrong = fixture('https://evil.test/')
    expect(await wrong.read(store, 'ticket')).toMatchObject({ recognized: false, total: null })
    expect(wrong.executeJavaScript).not.toHaveBeenCalled()
  })
})
