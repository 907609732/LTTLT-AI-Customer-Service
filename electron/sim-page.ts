/**
 * 「本机模拟店铺」的顾客侧网页。
 *
 * 为什么需要这一页：模拟店铺没有真实平台页面，验收“顾客发消息 → 采集 → 回复”这条链路时，
 * 需要有人能站在买家一侧把话问出去。这里就是那个唯一的买家入口。
 *
 * 边界（必须一直成立）：
 * - 纯本机：页面只由主进程的本地 HTTP 服务提供（见 electron/sim-server.ts），主进程用 esbuild
 *   打成 CJS 单文件，因此这里只能返回自包含字符串——没有外部脚本、样式、字体、图片或接口，
 *   不 import 任何 npm 包。任何外链都会在打包后变成断链，也会让“只在本机运行”的承诺失真。
 * - 不伪装平台：页面上如实标注“本机模拟”，不出现任何平台的品牌、logo、域名或话术承诺。
 *   客服在桌面端的回复也只写进本机模拟记录，不会发到任何真实平台或真实买家。
 * - 口令安全：服务端只把页面发给带正确口令的请求，所以口令从 location.search 读取，
 *   只放在请求的查询串里；页面不显示、不打印、不拼进错误文案。
 * - 防 XSS：顾客名字与消息内容全部用 textContent / createElement 渲染，绝不拼进 innerHTML。
 * - 实时刷新：SSE 只是“有变化了”的提示，消息内容永远以 GET /api/state 与 GET /api/thread 为准；
 *   SSE 连续失败超过 3 次就退化为每 3 秒轮询，并在页面上明示降级。
 */
export function renderSimPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>模拟顾客页 · 灵兔 AI</title>
    <style>
      :root {
        color-scheme: light;
        --brand: #5698fa;
        --brand-dark: #3f7fdb;
        --card: #f1f5fc;
        --line: #dbe6f7;
        --text: #1f2a3d;
        --sub: #64748b;
        --danger: #d9534f;
        --ok: #2f9e6f;
      }
      * {
        box-sizing: border-box;
      }
      [hidden] {
        display: none !important;
      }
      html,
      body {
        min-height: 100%;
      }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei',
          'PingFang SC', 'Hiragino Sans GB', sans-serif;
        font-size: 14px;
        line-height: 1.5;
        color: var(--text);
        background: #f7faff;
      }
      h1,
      h2 {
        margin: 0;
      }
      .app {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
      .topbar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px 20px;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        background: #ffffff;
        border-bottom: 1px solid var(--line);
      }
      .titles h1 {
        font-size: 18px;
        letter-spacing: 0.5px;
      }
      .notice {
        margin: 4px 0 0;
        font-size: 12px;
        color: var(--sub);
      }
      .store-picker {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .label {
        font-size: 12px;
        color: var(--sub);
        white-space: nowrap;
      }
      select,
      input,
      textarea {
        font: inherit;
        color: inherit;
      }
      select {
        min-width: 180px;
        padding: 7px 10px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #ffffff;
      }
      .banner {
        margin: 10px 18px 0;
        padding: 9px 12px;
        border-radius: 10px;
        font-size: 13px;
        word-break: break-word;
      }
      .banner-error {
        background: #fdeceb;
        border: 1px solid #f6c9c6;
        color: #a5322e;
      }
      .banner-warn {
        background: #fff6e5;
        border: 1px solid #f4dcae;
        color: #8a5b13;
      }
      .banner-info {
        background: var(--card);
        border: 1px solid var(--line);
        color: var(--sub);
      }
      .empty-stores {
        margin: 24px 18px;
        padding: 18px;
        background: #ffffff;
        border: 1px dashed var(--line);
        border-radius: 14px;
        color: var(--sub);
      }
      .workspace {
        flex: 1;
        display: flex;
        align-items: stretch;
        gap: 14px;
        min-height: 0;
        padding: 12px 18px 18px;
      }
      .sidebar {
        flex: 0 0 290px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 290px;
        padding: 12px;
        background: #ffffff;
        border: 1px solid var(--line);
        border-radius: 14px;
      }
      .sidebar-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
      }
      .sidebar-head h2 {
        font-size: 14px;
      }
      .sidebar-hint {
        font-size: 11px;
        color: var(--sub);
      }
      .persona-list {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 8px;
        min-height: 120px;
        overflow-y: auto;
      }
      .persona {
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
        padding: 8px 10px;
        text-align: left;
        background: var(--card);
        border: 1px solid transparent;
        border-radius: 10px;
        cursor: pointer;
      }
      .persona:hover {
        border-color: var(--line);
      }
      .persona.active {
        background: #e8f0ff;
        border-color: var(--brand);
      }
      .persona-name {
        display: flex;
        gap: 6px;
        align-items: center;
        font-size: 14px;
        font-weight: 600;
      }
      .persona-badge {
        padding: 0 6px;
        font-size: 11px;
        font-weight: 400;
        color: #ffffff;
        background: var(--brand);
        border-radius: 999px;
      }
      .persona-sub,
      .persona-empty {
        overflow: hidden;
        font-size: 12px;
        color: var(--sub);
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .persona-empty {
        margin: 4px 2px;
        white-space: normal;
      }
      .persona-form {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-top: 8px;
        border-top: 1px solid var(--line);
      }
      .field {
        width: 100%;
        padding: 7px 10px;
        background: #ffffff;
        border: 1px solid var(--line);
        border-radius: 10px;
      }
      .field:focus-visible,
      .input:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--brand);
        outline-offset: 1px;
      }
      .btn {
        padding: 7px 12px;
        color: var(--text);
        background: #ffffff;
        border: 1px solid var(--line);
        border-radius: 10px;
        cursor: pointer;
      }
      .btn:hover:enabled {
        border-color: var(--brand);
      }
      .btn:disabled {
        color: #9aa6b8;
        background: #f4f7fc;
        cursor: not-allowed;
      }
      .btn-primary {
        color: #ffffff;
        background: var(--brand);
        border-color: var(--brand);
      }
      .btn-primary:hover:enabled {
        background: var(--brand-dark);
        border-color: var(--brand-dark);
      }
      .btn-danger {
        color: var(--danger);
        border-color: #f0c7c5;
      }
      .btn-danger:hover:enabled {
        border-color: var(--danger);
      }
      .persona-tools {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .persona-tools .btn {
        flex: 1;
        font-size: 12px;
      }
      .chat {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
        background: #ffffff;
        border: 1px solid var(--line);
        border-radius: 14px;
      }
      .chat-head {
        display: flex;
        flex-wrap: wrap;
        gap: 2px 10px;
        align-items: baseline;
        padding: 12px 14px;
        border-bottom: 1px solid var(--line);
      }
      .chat-head h2 {
        font-size: 15px;
      }
      .chat-sub {
        font-size: 12px;
        color: var(--sub);
      }
      .messages {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 10px;
        min-height: 200px;
        padding: 16px;
        overflow-y: auto;
        background: #fbfdff;
      }
      .msg {
        display: flex;
        flex-direction: column;
        max-width: 78%;
      }
      .msg.buyer {
        align-self: flex-start;
        align-items: flex-start;
      }
      .msg.seller {
        align-self: flex-end;
        align-items: flex-end;
      }
      .bubble {
        padding: 9px 12px;
        font-size: 14px;
        line-height: 1.55;
        white-space: pre-wrap;
        word-break: break-word;
        background: var(--card);
        border-radius: 12px;
      }
      .msg.seller .bubble {
        color: #ffffff;
        background: var(--brand);
      }
      .time {
        margin-top: 4px;
        font-size: 11px;
        color: var(--sub);
      }
      .messages-empty {
        margin: auto;
        padding: 12px;
        font-size: 13px;
        color: var(--sub);
        text-align: center;
      }
      .composer {
        display: flex;
        gap: 8px;
        padding: 10px 12px 0;
        background: #ffffff;
        border-top: 1px solid var(--line);
      }
      .input {
        flex: 1;
        min-height: 62px;
        padding: 9px 11px;
        resize: vertical;
        background: #ffffff;
        border: 1px solid var(--line);
        border-radius: 12px;
      }
      .input:disabled {
        background: #f7f9fd;
        color: #9aa6b8;
      }
      .send {
        align-self: flex-end;
        min-width: 82px;
        padding: 9px 14px;
      }
      .quick-phrases {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 12px;
      }
      .quick {
        padding: 5px 10px;
        font-size: 12px;
        color: #37639f;
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 999px;
        cursor: pointer;
      }
      .quick:hover {
        border-color: var(--brand);
      }
      .foot-note {
        margin: 0;
        padding: 0 12px 12px;
        font-size: 12px;
        color: var(--sub);
      }
      @media (max-width: 760px) {
        .topbar {
          padding: 12px;
        }
        .workspace {
          flex-direction: column;
          padding: 10px;
        }
        .sidebar {
          flex: 0 0 auto;
          width: auto;
        }
        .persona-list {
          flex-direction: row;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .persona {
          flex: 0 0 auto;
          width: 168px;
        }
        .chat {
          min-height: 62vh;
        }
        .msg {
          max-width: 88%;
        }
      }
    </style>
  </head>
  <body>
    <div class="app">
      <header class="topbar">
        <div class="titles">
          <h1>模拟顾客页</h1>
          <p class="notice">本机模拟顾客页 · 只在本机运行 · 不代表真实平台、真实买家或真实登录</p>
        </div>
        <div class="store-picker">
          <label class="label" for="store-select">当前店铺</label>
          <select id="store-select" aria-label="当前本机模拟店铺"></select>
          <button id="reload-stores" class="btn" type="button" title="重新读取本机模拟店铺">
            刷新
          </button>
        </div>
      </header>

      <div id="error-banner" class="banner banner-error" role="alert" hidden></div>
      <div id="degraded-banner" class="banner banner-warn" role="status" hidden>
        实时刷新已降级为轮询
      </div>
      <div id="loading-hint" class="banner banner-info" role="status">正在连接本机模拟服务…</div>

      <p id="empty-stores" class="empty-stores" hidden>
        还没有本机模拟店铺。请先在桌面端『添加店铺』里选择『本机模拟店铺』并打开店铺，再回到这个页面。
      </p>

      <main id="workspace" class="workspace" hidden>
        <section class="sidebar" aria-label="本机模拟顾客">
          <div class="sidebar-head">
            <h2>顾客</h2>
            <span class="sidebar-hint">只在本机</span>
          </div>
          <div id="persona-list" class="persona-list"></div>
          <form id="persona-form" class="persona-form">
            <input
              id="new-name"
              class="field"
              type="text"
              maxlength="24"
              autocomplete="off"
              placeholder="顾客名字（必填）"
              aria-label="新顾客名字"
            />
            <input
              id="new-note"
              class="field"
              type="text"
              maxlength="60"
              autocomplete="off"
              placeholder="备注（可选，例如：问尺码）"
              aria-label="新顾客备注"
            />
            <button id="add-persona" class="btn btn-primary" type="submit">新增顾客</button>
          </form>
          <div class="persona-tools">
            <button id="rename-persona" class="btn" type="button" disabled>重命名</button>
            <button
              id="remove-persona"
              class="btn btn-danger"
              type="button"
              disabled
              title="只删除本机模拟顾客与其本机记录，不影响任何真实平台账号或真实买家"
            >
              删除（只删本机记录）
            </button>
          </div>
        </section>

        <section class="chat" aria-label="本机模拟会话">
          <div class="chat-head">
            <h2 id="chat-title">未选择顾客</h2>
            <span id="chat-sub" class="chat-sub"></span>
          </div>
          <div id="messages" class="messages" aria-live="polite"></div>
          <div class="composer">
            <textarea
              id="message-input"
              class="input"
              maxlength="2000"
              rows="3"
              placeholder="以顾客身份问一句…（Enter 发送，Shift+Enter 换行）"
              aria-label="顾客消息内容"
            ></textarea>
            <button id="send-button" class="btn btn-primary send" type="button">发送</button>
          </div>
          <div id="quick-phrases" class="quick-phrases" aria-label="快捷短语"></div>
          <p class="foot-note">
            这里只是本机模拟：客服（桌面端）的回复只会出现在本机模拟记录里，不会发送到任何真实平台。
          </p>
        </section>
      </main>
    </div>

    <noscript>这个页面需要本机浏览器允许运行 JavaScript，才能读取本机模拟数据。</noscript>

    <script>
      ;(function () {
        'use strict'

        // 口令只从当前地址的查询串读取：服务端只把页面发给带正确口令的请求。
        // 页面不嵌入、不显示口令，也不把它写进任何错误文案或日志；请求时统一放回查询串。
        var token = new URLSearchParams(location.search).get('token') || ''

        // 快捷短语只是把话填入输入框，是否会发出去由人决定；文案本身不含任何承诺。
        var QUICK_PHRASES = ['在吗？', '这个有现货吗？', '什么时候发货？', '能便宜点吗？']
        var MAX_LENGTH = 2000
        var POLL_INTERVAL = 3000
        // SSE 连续失败超过这个次数就退化：短暂抖动交给 EventSource 自带的重连处理。
        var MAX_SSE_FAILURES = 3
        var REFRESH_DELAY = 120

        var state = {
          stores: [],
          storeId: '',
          storeName: '',
          personas: [],
          selectedUid: '',
          messages: [],
          sending: false,
          degraded: false,
          // 口令失效后不再自动重连，只有用户再点一次刷新/换店铺才重新尝试。
          tokenRejected: false
        }
        var refreshSource = null
        var pollTimer = null
        var refreshTimer = null
        var sseFailures = 0

        var el = {
          storeSelect: document.getElementById('store-select'),
          reload: document.getElementById('reload-stores'),
          error: document.getElementById('error-banner'),
          degraded: document.getElementById('degraded-banner'),
          loading: document.getElementById('loading-hint'),
          emptyStores: document.getElementById('empty-stores'),
          workspace: document.getElementById('workspace'),
          personaList: document.getElementById('persona-list'),
          personaForm: document.getElementById('persona-form'),
          newName: document.getElementById('new-name'),
          newNote: document.getElementById('new-note'),
          addPersona: document.getElementById('add-persona'),
          rename: document.getElementById('rename-persona'),
          remove: document.getElementById('remove-persona'),
          chatTitle: document.getElementById('chat-title'),
          chatSub: document.getElementById('chat-sub'),
          messages: document.getElementById('messages'),
          input: document.getElementById('message-input'),
          send: document.getElementById('send-button'),
          quick: document.getElementById('quick-phrases')
        }

        function apiUrl(path, params) {
          var query = new URLSearchParams(params || {})
          query.set('token', token)
          return path + '?' + query.toString()
        }

        function showError(message) {
          el.error.textContent = message
          el.error.hidden = false
        }

        function clearError() {
          el.error.textContent = ''
          el.error.hidden = true
        }

        function setDegraded(value) {
          state.degraded = value
          el.degraded.hidden = !value
        }

        // 失败原因必须原样显示：模拟服务的 message 是写给人看的，
        // 既不吞掉、也不改写成“成功”或“已送达”这类占位描述。
        function call(method, path, params, body) {
          var options = { method: method, cache: 'no-store' }
          if (body !== undefined) {
            options.headers = { 'Content-Type': 'application/json' }
            options.body = JSON.stringify(body)
          }
          return fetch(apiUrl(path, params), options).then(
            function (response) {
              return response.text().then(function (raw) {
                var payload = null
                try {
                  payload = JSON.parse(raw)
                } catch (ignored) {
                  payload = null
                }
                if (!payload || typeof payload !== 'object') {
                  return {
                    ok: false,
                    status: response.status,
                    data: null,
                    message: '本机模拟服务返回了无法识别的响应（HTTP ' + response.status + '）。'
                  }
                }
                if (response.ok && payload.ok === true) {
                  return { ok: true, status: response.status, data: payload, message: '' }
                }
                var reason =
                  typeof payload.message === 'string' && payload.message
                    ? payload.message
                    : '本机模拟服务返回失败但没有给出原因（HTTP ' + response.status + '）。'
                return { ok: false, status: response.status, data: payload, message: reason }
              })
            },
            function () {
              // 网络层错误不拼接请求地址：地址里带口令，不能出现在界面、日志或错误文案里。
              return {
                ok: false,
                status: 0,
                data: null,
                message: '无法连接本机模拟服务，请确认桌面端『灵兔 AI』仍在运行。'
              }
            }
          )
        }

        // 口令只在这次打开的页面里有效；桌面端重开模拟服务后旧口令失效，
        // 这时继续重连或轮询只会反复刷同样的错误，停掉刷新通道并让用户回桌面端重开页面。
        function authRejected(result) {
          if (result.status !== 401 && result.status !== 403) return false
          state.tokenRejected = true
          stopRefreshChannel()
          return true
        }

        function currentPersona() {
          for (var i = 0; i < state.personas.length; i += 1) {
            if (state.personas[i].uid === state.selectedUid) return state.personas[i]
          }
          return null
        }

        function summaryOf(persona) {
          var parts = []
          if (persona.note) parts.push(persona.note)
          if (persona.lastMessage) parts.push(persona.lastMessage)
          return parts.length ? parts.join(' · ') : '还没有消息'
        }

        function pad2(value) {
          return value < 10 ? '0' + value : String(value)
        }

        function formatTime(ts) {
          var date = new Date(Number(ts) || 0)
          if (isNaN(date.getTime())) return '--:--'
          return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
        }

        function renderPersonas() {
          el.personaList.textContent = ''
          if (!state.personas.length) {
            var hint = document.createElement('p')
            hint.className = 'persona-empty'
            hint.textContent = '这家模拟店铺还没有顾客，先在下面新增一位吧。'
            el.personaList.appendChild(hint)
            return
          }
          state.personas.forEach(function (persona) {
            var item = document.createElement('button')
            item.type = 'button'
            var active = persona.uid === state.selectedUid
            item.className = 'persona' + (active ? ' active' : '')
            item.setAttribute('aria-pressed', active ? 'true' : 'false')
            item.addEventListener('click', function () {
              selectPersona(persona.uid)
            })

            var name = document.createElement('span')
            name.className = 'persona-name'
            // 顾客名字来自数据，只能当文本节点，不能拼进 HTML。
            name.textContent = persona.name
            if (Number(persona.unread) > 0) {
              var badge = document.createElement('span')
              badge.className = 'persona-badge'
              // 这个数字是「顾客最后几句话还没人回」，不是社交软件里的未读红点。
              badge.title = '待回复条数'
              badge.textContent = String(Number(persona.unread))
              name.appendChild(badge)
            }
            item.appendChild(name)

            var summary = document.createElement('span')
            summary.className = 'persona-sub'
            summary.textContent = summaryOf(persona)
            item.appendChild(summary)

            el.personaList.appendChild(item)
          })
        }

        function updateComposerState() {
          var hasPersona = currentPersona() !== null
          el.input.disabled = !hasPersona || state.sending
          el.send.disabled = !hasPersona || state.sending
          el.send.textContent = state.sending ? '发送中…' : '发送'
          el.rename.disabled = !hasPersona
          el.remove.disabled = !hasPersona
        }

        function renderChatHead() {
          var persona = currentPersona()
          if (!persona) {
            el.chatTitle.textContent = '未选择顾客'
            el.chatSub.textContent = state.storeName ? '本机模拟店铺：' + state.storeName : ''
          } else {
            el.chatTitle.textContent = persona.name
            var parts = [state.storeName ? '本机模拟店铺：' + state.storeName : '本机模拟顾客']
            if (persona.note) parts.push(persona.note)
            el.chatSub.textContent = parts.join(' · ')
          }
          updateComposerState()
        }

        function renderMessages() {
          el.messages.textContent = ''
          if (!state.selectedUid) {
            var pick = document.createElement('p')
            pick.className = 'messages-empty'
            pick.textContent = state.personas.length
              ? '先在左侧选择一位顾客，就可以替他（她）问一句话。'
              : '还没有顾客，先在左侧新增一位模拟顾客。'
            el.messages.appendChild(pick)
            return
          }
          if (!state.messages.length) {
            var empty = document.createElement('p')
            empty.className = 'messages-empty'
            empty.textContent = '还没有消息，试着以顾客身份问一句'
            el.messages.appendChild(empty)
            return
          }
          state.messages.forEach(function (message) {
            var seller = message.from === 'seller'
            var row = document.createElement('div')
            row.className = 'msg ' + (seller ? 'seller' : 'buyer')

            var bubble = document.createElement('div')
            bubble.className = 'bubble'
            // 消息正文同样只用 textContent，避免顾客输入被当作 HTML 执行。
            bubble.textContent = message.content
            row.appendChild(bubble)

            var time = document.createElement('div')
            time.className = 'time'
            time.textContent = (seller ? '客服（本机模拟） ' : '顾客 ') + formatTime(message.ts)
            row.appendChild(time)

            el.messages.appendChild(row)
          })
          el.messages.scrollTop = el.messages.scrollHeight
        }

        function renderQuickPhrases() {
          QUICK_PHRASES.forEach(function (phrase) {
            var button = document.createElement('button')
            button.type = 'button'
            button.className = 'quick'
            button.textContent = phrase
            button.addEventListener('click', function () {
              el.input.value = phrase
              el.input.focus()
            })
            el.quick.appendChild(button)
          })
        }

        function loadThread(uid) {
          if (!uid || !state.storeId) {
            state.messages = []
            renderMessages()
            return Promise.resolve()
          }
          return call('GET', '/api/thread', { storeId: state.storeId, uid: uid }).then(function (
            result
          ) {
            if (result.ok === false) {
              showError(result.message)
              return
            }
            // 请求期间可能已切换顾客，丢弃过期响应，避免把别人的话显示在当前会话里。
            if (uid !== state.selectedUid) return
            var list = Array.isArray(result.data.messages) ? result.data.messages : []
            state.messages = list.filter(function (message) {
              return message && typeof message.content === 'string'
            })
            renderMessages()
          })
        }

        function refreshState() {
          if (!state.storeId) return Promise.resolve()
          return call('GET', '/api/state', { storeId: state.storeId }).then(function (result) {
            if (result.ok === false) {
              showError(result.message)
              authRejected(result)
              return
            }
            clearError()
            var data = result.data
            state.storeName = typeof data.storeName === 'string' ? data.storeName : state.storeId
            var list = Array.isArray(data.personas) ? data.personas : []
            state.personas = list.filter(function (persona) {
              return persona && typeof persona.uid === 'string'
            })
            var keep = false
            state.personas.forEach(function (persona) {
              if (persona.uid === state.selectedUid) keep = true
            })
            if (!keep) state.selectedUid = state.personas.length ? state.personas[0].uid : ''
            renderPersonas()
            renderChatHead()
            return loadThread(state.selectedUid)
          })
        }

        function selectPersona(uid) {
          if (!uid || uid === state.selectedUid) return
          state.selectedUid = uid
          state.messages = []
          clearError()
          renderPersonas()
          renderChatHead()
          renderMessages()
          loadThread(uid)
        }

        function activateStore(storeId) {
          stopRefreshChannel()
          setDegraded(false)
          state.storeId = storeId
          state.storeName = ''
          state.selectedUid = ''
          state.messages = []
          renderPersonas()
          renderChatHead()
          renderMessages()
          return refreshState().then(function () {
            startRefreshChannel()
          })
        }

        function loadStores() {
          // 用户主动刷新/重新选店铺时允许再试一次：桌面端可能已经重开模拟服务并换了口令。
          state.tokenRejected = false
          return call('GET', '/api/stores').then(function (result) {
            el.loading.hidden = true
            if (result.ok === false) {
              showError(result.message)
              authRejected(result)
              return
            }
            var list = Array.isArray(result.data.stores) ? result.data.stores : []
            state.stores = list.filter(function (store) {
              return store && typeof store.storeId === 'string'
            })
            el.storeSelect.textContent = ''
            state.stores.forEach(function (store) {
              var option = document.createElement('option')
              option.value = store.storeId
              option.textContent = store.storeName || store.storeId
              el.storeSelect.appendChild(option)
            })
            if (!state.stores.length) {
              // 没有模拟店铺时不伪造任何数据，只给出下一步该做什么。
              state.storeId = ''
              state.storeName = ''
              state.personas = []
              state.selectedUid = ''
              state.messages = []
              stopRefreshChannel()
              el.emptyStores.hidden = false
              el.workspace.hidden = true
              el.storeSelect.disabled = true
              renderPersonas()
              renderChatHead()
              renderMessages()
              return
            }
            el.emptyStores.hidden = true
            el.workspace.hidden = false
            el.storeSelect.disabled = false
            var exists = false
            state.stores.forEach(function (store) {
              if (store.storeId === state.storeId) exists = true
            })
            if (!exists) state.storeId = state.stores[0].storeId
            el.storeSelect.value = state.storeId
            return activateStore(state.storeId)
          })
        }

        function sendMessage() {
          if (state.sending || el.input.disabled) return
          if (!state.storeId || !state.selectedUid) {
            showError('请先选择本机模拟店铺和顾客。')
            return
          }
          var text = el.input.value.trim()
          if (!text) {
            showError('消息不能为空。')
            return
          }
          if (text.length > MAX_LENGTH) {
            showError('消息不能超过 ' + MAX_LENGTH + ' 字。')
            return
          }
          var uid = state.selectedUid
          state.sending = true
          updateComposerState()
          call('POST', '/api/send', {}, {
            storeId: state.storeId,
            uid: uid,
            text: text,
            as: 'buyer'
          }).then(function (result) {
            state.sending = false
            updateComposerState()
            if (result.ok === false) {
              // 失败：错误原样显示，输入框内容保持不动，方便改一改再发。
              showError(result.message)
              return
            }
            clearError()
            el.input.value = ''
            var message = result.data.message
            if (message && typeof message.content === 'string' && uid === state.selectedUid) {
              state.messages.push({
                msgId: typeof message.msgId === 'string' ? message.msgId : '',
                from: message.from === 'seller' ? 'seller' : 'buyer',
                content: message.content,
                ts: Number(message.ts) || Date.now()
              })
              renderMessages()
            }
            // 再拉一次状态，让左侧摘要与消息数以服务端为准（SSE 只是加速，不是数据来源）。
            refreshState()
          })
        }

        function addPersona() {
          if (!state.storeId) {
            showError('请先选择本机模拟店铺。')
            return
          }
          var name = el.newName.value.trim()
          if (!name) {
            showError('顾客名字不能为空。')
            el.newName.focus()
            return
          }
          var note = el.newNote.value.trim()
          el.addPersona.disabled = true
          call('POST', '/api/persona', {}, {
            storeId: state.storeId,
            name: name,
            note: note
          }).then(function (result) {
            el.addPersona.disabled = false
            if (result.ok === false) {
              showError(result.message)
              return
            }
            clearError()
            el.newName.value = ''
            el.newNote.value = ''
            var persona = result.data.persona
            if (persona && typeof persona.uid === 'string') state.selectedUid = persona.uid
            refreshState()
          })
        }

        function renamePersona() {
          var persona = currentPersona()
          if (!persona) {
            showError('请先选择一位模拟顾客。')
            return
          }
          var next = window.prompt('重命名这位本机模拟顾客（只改本机模拟记录）', persona.name)
          if (next === null) return
          var name = next.trim()
          if (!name) {
            showError('顾客名字不能为空。')
            return
          }
          call('PATCH', '/api/persona', {}, {
            storeId: state.storeId,
            uid: persona.uid,
            name: name
          }).then(function (result) {
            if (result.ok === false) {
              showError(result.message)
              return
            }
            clearError()
            refreshState()
          })
        }

        function removePersona() {
          var persona = currentPersona()
          if (!persona) {
            showError('请先选择一位模拟顾客。')
            return
          }
          var question =
            '只删除本机模拟顾客与其本机记录，不会影响任何真实平台或真实买家。确定删除“' +
            persona.name +
            '”吗？'
          if (!window.confirm(question)) return
          call('DELETE', '/api/persona', {}, {
            storeId: state.storeId,
            uid: persona.uid
          }).then(function (result) {
            if (result.ok === false) {
              showError(result.message)
              return
            }
            clearError()
            state.selectedUid = ''
            state.messages = []
            refreshState()
          })
        }

        function scheduleRefresh() {
          // SSE 可能连续推来多条「有变化」事件，合并成一次拉取，避免把本机服务打满。
          if (refreshTimer !== null) return
          refreshTimer = window.setTimeout(function () {
            refreshTimer = null
            refreshState()
          }, REFRESH_DELAY)
        }

        function stopRefreshChannel() {
          if (refreshSource) {
            refreshSource.close()
            refreshSource = null
          }
          if (pollTimer !== null) {
            window.clearInterval(pollTimer)
            pollTimer = null
          }
          if (refreshTimer !== null) {
            window.clearTimeout(refreshTimer)
            refreshTimer = null
          }
          sseFailures = 0
        }

        function startPolling() {
          if (pollTimer !== null) return
          pollTimer = window.setInterval(function () {
            if (!state.storeId) return
            refreshState()
          }, POLL_INTERVAL)
        }

        function startEvents() {
          if (typeof EventSource !== 'function') {
            setDegraded(true)
            startPolling()
            return
          }
          var source = null
          try {
            source = new EventSource(apiUrl('/api/events', { storeId: state.storeId }))
          } catch (ignored) {
            setDegraded(true)
            startPolling()
            return
          }
          refreshSource = source
          source.onopen = function () {
            sseFailures = 0
          }
          // 事件只说“这家店有变化”，消息内容一律重新 GET /api/state 与 /api/thread。
          source.onmessage = function () {
            sseFailures = 0
            scheduleRefresh()
          }
          source.onerror = function () {
            sseFailures += 1
            if (sseFailures > MAX_SSE_FAILURES) {
              if (refreshSource) {
                refreshSource.close()
                refreshSource = null
              }
              setDegraded(true)
              startPolling()
            }
          }
        }

        function startRefreshChannel() {
          stopRefreshChannel()
          if (!state.storeId) return
          // 口令已失效时不再自动连接，避免对着同一个 401 无限重连。
          if (state.tokenRejected) return
          if (state.degraded) {
            startPolling()
            return
          }
          startEvents()
        }

        el.storeSelect.addEventListener('change', function () {
          clearError()
          activateStore(el.storeSelect.value)
        })
        el.reload.addEventListener('click', function () {
          clearError()
          loadStores()
        })
        el.personaForm.addEventListener('submit', function (event) {
          event.preventDefault()
          addPersona()
        })
        el.rename.addEventListener('click', renamePersona)
        el.remove.addEventListener('click', removePersona)
        el.send.addEventListener('click', sendMessage)
        el.input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            sendMessage()
          }
        })

        renderQuickPhrases()
        // 还没选到顾客前禁止发送，避免发出没有归属的本机模拟消息。
        updateComposerState()
        loadStores()
      })()
    </script>
  </body>
</html>`
}

/**
 * 口令不对时的顾客页替身。
 *
 * 为什么不直接返回纯文本：这个地址会被用户真的用浏览器打开（复制粘贴、收藏、刷新），
 * 纯文本会让“打开失败”看起来像页面坏了。这里给一张最小说明页：说明为什么打不开、去桌面端哪里重开，
 * 但不透露口令、不复述对方给的值，也不提供任何重试入口——能不能进去只由桌面端决定。
 */
export function renderSimGatePage(message: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>模拟顾客页 · 灵兔 AI</title>
    <style>
      :root {
        color-scheme: light;
        --brand: #5698fa;
        --line: #dbe6f7;
        --text: #1f2a3d;
        --sub: #64748b;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: #f7f9fd;
        color: var(--text);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
      }
      main {
        width: 100%;
        max-width: 480px;
        padding: 28px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 12px 32px rgb(31 42 61 / 8%);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 18px;
      }
      p {
        margin: 0 0 12px;
        font-size: 14px;
        line-height: 1.7;
        color: var(--sub);
      }
      ol {
        margin: 0;
        padding-left: 20px;
        font-size: 14px;
        line-height: 1.9;
        color: var(--text);
      }
      strong {
        color: var(--brand);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>模拟顾客页打不开</h1>
      <p>${message}</p>
      <ol>
        <li>回到灵兔 AI桌面端，打开「模拟客服台」。</li>
        <li>选中本机模拟店铺，点「打开模拟顾客页」。</li>
        <li>用桌面端给的新地址重新打开。</li>
      </ol>
      <p>模拟顾客页只在本机运行，不连接任何真实平台，也没有真实买家。</p>
    </main>
  </body>
</html>`
}
