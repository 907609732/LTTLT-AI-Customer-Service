import { describe, expect, it } from 'vitest'
import { renderSimPage } from '../electron/sim-page'

// 页面由主进程本地 HTTP 服务直接吐出，且主进程会被 esbuild 打成单个 CJS 文件，
// 这里对“页面字符串本身”做契约检查：文档外壳、接口路径、安全边界与可解析性。
const html = renderSimPage()

function parse(): Document {
  // jsdom 环境提供 DOMParser；按浏览器的方式解析，顺便验证 HTML 结构没被写坏。
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('renderSimPage', () => {
  it('返回完整的 HTML 文档外壳', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="zh-CN">')
    expect(html).toContain('<title>模拟顾客页')
  })

  it('声明页面会调用的本机模拟接口', () => {
    for (const path of [
      '/api/stores',
      '/api/state',
      '/api/thread',
      '/api/send',
      '/api/persona',
      '/api/events',
    ]) {
      expect(html).toContain(path)
    }
  })

  it('口令从地址查询串读取，不硬编码在页面里', () => {
    expect(html).toContain('location.search')
    expect(html).toContain('token')
    // 口令通过查询参数传递；页面源码里不应出现写死的示例口令。
    expect(html).toContain("query.set('token', token)")
  })

  it('如实标注本机模拟，不伪装成真实平台', () => {
    expect(html).toContain('本机模拟')
    expect(html).toContain('不代表真实平台')
    expect(html).toContain('不会发送到任何真实平台')
    // 不允许出现任何平台品牌域名或登录承诺的痕迹。
    expect(html).not.toContain('pinduoduo')
    expect(html).not.toContain('yangkeduo')
    expect(html).not.toContain('jinritemai')
  })

  it('不引用任何外部资源，页面完全自包含', () => {
    expect(html).not.toContain('http://')
    expect(html).not.toContain('https://')
    expect(html).not.toContain('<script src=')
    expect(html).not.toContain('<link')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('@import')
    expect(html).not.toContain('url(')
  })

  it('不使用 innerHTML 拼装动态内容', () => {
    // 顾客名字与消息正文一律 textContent / createElement，避免 XSS。
    expect(html).not.toContain('innerHTML')
    expect(html).not.toContain('outerHTML')
    expect(html).not.toContain('insertAdjacentHTML')
    expect(html).not.toContain('document.write')
  })

  it('包含实时刷新降级为轮询的提示', () => {
    expect(html).toContain('实时刷新已降级为轮询')
    expect(html).toContain('EventSource')
    expect(html).toMatch(/POLL_INTERVAL\s*=\s*3000/)
  })

  it('包含空态文案与超长输入限制', () => {
    expect(html).toContain('还没有本机模拟店铺')
    expect(html).toContain('还没有消息，试着以顾客身份问一句')
    expect(html).toContain('maxlength="2000"')
  })

  it('可被 DOMParser 解析出内联脚本与标题', () => {
    const doc = parse()
    expect(doc.querySelectorAll('script').length).toBeGreaterThanOrEqual(1)
    expect(doc.title).toContain('模拟顾客页')
  })

  it('内联脚本全部可解析，且不依赖 src', () => {
    const doc = parse()
    const scripts = [...doc.querySelectorAll('script')]
    expect(scripts.length).toBeGreaterThanOrEqual(1)
    for (const script of scripts) {
      expect(script.getAttribute('src')).toBeNull()
      const code = script.textContent || ''
      expect(code.length).toBeGreaterThan(0)
      // 只编译不执行：确认内联脚本没有因为字符串转义而出现语法错误。
      expect(() => new Function(code)).not.toThrow()
    }
  })
})
