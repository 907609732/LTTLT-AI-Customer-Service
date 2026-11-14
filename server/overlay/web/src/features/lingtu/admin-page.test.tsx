import { webcrypto } from 'node:crypto'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { AxiosError } from 'axios'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { AdminPage } from './admin-page'

const { verify } = vi.hoisted(() => ({
  verify: vi.fn(async (): Promise<{ proof_token: string } | null> => ({
    proof_token: 'fixture-proof',
  })),
}))
vi.mock('@/features/auth/secure-verification', () => ({
  useSecureVerification: () => ({
    requestVerification: verify,
    dialogProps: {},
  }),
  SecureVerificationDialog: () => null,
}))
const originalAdapter = api.defaults.adapter
const originalAuth = useAuthStore.getState().auth
afterEach(() => {
  cleanup()
  api.defaults.adapter = originalAdapter
  useAuthStore.setState({ auth: originalAuth })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
beforeEach(async () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 300,
    top: 0,
    left: 0,
    right: 800,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  localStorage.clear()
  i18next.addResourceBundle('zhCN', 'translation', zh.translation, true, true)
  i18next.addResourceBundle('en', 'translation', en.translation, true, true)
  await i18next.changeLanguage('en')
})
const config = {
  policy: {
    calls: 20,
    days: 7,
    daily_calls: 200,
    max_tokens: 512,
    default_model: 'deepseek-flash',
  },
  login_providers: [],
  model_providers: [],
  smtp: {},
}
const totals = {
  requests: 2,
  successes: 1,
  failed: 0,
  uncertain: 1,
  input_tokens: 12,
  output_tokens: 8,
  total_tokens: 20,
  unknown_usage: 1,
}
function fixtureData(
  url: string,
  params: Record<string, unknown> = {},
  configuration: unknown = config
): unknown {
  if (url.endsWith('/accounts')) {
    return {
      items: [
        {
          user_id: 9,
          display_name: '客服小王',
          status: 'enabled',
          limit: 20,
          used: 1,
          reserved: 1,
          expires_at: 1900000000,
          model: '',
        },
      ],
      total: 1,
      page: 1,
    }
  }
  if (url.endsWith('/usage-daily')) {
    return {
      scope: 'clients_only',
      timezone: 'Asia/Shanghai',
      days: Number(params.days || 7),
      model: '',
      today: totals,
      totals,
      items: [
        {
          ...totals,
          date: '2026-11-13',
          model: 'managed-7',
          channel_id: 7,
          channel_name: 'Historical API',
          upstream_model: 'old-model',
        },
      ],
      model_options: ['managed-7'],
    }
  }
  if (url.endsWith('/usage-summary')) {
    return {
      totals,
      items: [
        {
          ...totals,
          user_id: 9,
          display_name: '客服小王',
          last_used_at: 1730000000,
        },
      ],
      total: 1,
      page: Number(params.page || 1),
    }
  }
  if (url.endsWith('/usage')) {
    return {
      items: [
        {
          user_id: 9,
          display_name: '客服小王',
          request_id: 'request-one',
          state: 'uncertain',
          created_at: 1730000000,
          model: 'qwen-plus',
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          usage_known: false,
          diagnostic: 'result_unknown',
        },
      ],
      total: 21,
      page: Number(params.page || 1),
    }
  }
  if (url.endsWith('/audit')) {
    return {
      items: [
        {
          id: 1,
          actor_id: 1,
          target_id: 9,
          section: 'account',
          outcome: 'success',
          reason: 'reviewed quota',
          created_at: 1730000000,
        },
      ],
      total: 1,
      page: 1,
    }
  }
  return configuration
}
function installFixture(configuration: unknown = config) {
  api.defaults.adapter = async (request) => ({
    data: fixtureData(request.url || '', request.params, configuration),
    status: 200,
    statusText: 'OK',
    headers: {},
    config: request,
  })
}
function allowProtectedSave() {
  vi.stubGlobal('crypto', webcrypto)
  useAuthStore.setState({
    auth: {
      ...useAuthStore.getState().auth,
      accessToken: 'fixture-access',
      accessExpiresAt: Math.floor(Date.now() / 1000) + 900,
    },
  })
}
function renderAdmin() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <AdminPage />
    </QueryClientProvider>
  )
}

it('exposes all management sections by default in Chinese and persists an English language choice across remounts', async () => {
  installFixture()
  const view = renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  for (const name of [
    '概览',
    '模型配置',
    '账号管理',
    '用量记录',
    '登录方式',
    '试用设置',
    '充值与计费',
  ]) {
    expect(screen.getByRole('tab', { name })).toBeTruthy()
  }
  expect((await screen.findAllByText('客户端调用次数')).length).toBeGreaterThan(
    0
  )
  expect(screen.getAllByText('已返回的词元总量').length).toBeGreaterThan(0)
  expect(document.documentElement.lang).toBe('zh-CN')
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  await screen.findByRole('heading', {
    name: 'Lingtu AI administration',
  })
  for (const name of [
    'Overview',
    'Model configuration',
    'Account management',
    'Usage records',
    'Sign-in methods',
    'Trial settings',
  ]) {
    expect(screen.getByRole('tab', { name })).toBeTruthy()
  }
  expect(document.documentElement.lang).toBe('en')
  expect(localStorage.getItem('lingtu-admin-language')).toBe('en')
  view.unmount()
  renderAdmin()
  expect(
    await screen.findByRole('heading', {
      name: 'Lingtu AI administration',
    })
  ).toBeTruthy()
  expect(i18next.language).toBe('en')
})

it('filters both per-account totals and request details after selecting an account and labels missing usage honestly', async () => {
  const requests: { url: string; params: Record<string, unknown> }[] = []
  api.defaults.adapter = async (request) => {
    requests.push({ url: request.url || '', params: request.params || {} })
    return {
      data: fixtureData(request.url || '', request.params),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('tab', { name: '账号管理' }))
  fireEvent.click(await screen.findByRole('button', { name: '查看用量' }))
  expect(await screen.findByText('request-one')).toBeTruthy()
  await waitFor(() =>
    expect(
      requests.some(
        (request) =>
          request.url.endsWith('/usage-summary') && request.params.user_id === 9
      )
    ).toBe(true)
  )
  expect(
    requests.some(
      (request) =>
        request.url.endsWith('/usage') && request.params.user_id === 9
    )
  ).toBe(true)
  expect(
    (screen.getByLabelText('按账号编号筛选') as HTMLInputElement).value
  ).toBe('9')
  expect(screen.getAllByText('未返回用量')).toHaveLength(2)
  expect(screen.queryByText('0 / 0')).toBeNull()
  expect(screen.queryByText('result_unknown')).toBeNull()
  expect(
    screen.getByRole('columnheader', { name: '未返回用量的调用' })
  ).toBeTruthy()
  expect(
    screen.getByText('此处仅统计客户端实际发起的模型调用，不包含模型连接检测。')
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '全部账号' }))
  await waitFor(() =>
    expect(
      (screen.getByLabelText('按账号编号筛选') as HTMLInputElement).value
    ).toBe('')
  )
})

it('paginates usage and audit and reconciles only through a reason-bound security proof', async () => {
  const posts: Record<string, unknown>[] = []
  const pages: number[] = []
  allowProtectedSave()
  api.defaults.adapter = async (request) => {
    if (request.url?.endsWith('/usage')) {
      pages.push(Number(request.params?.page || 1))
    }
    let data = fixtureData(request.url || '', request.params)
    if (request.method === 'post') {
      expect(request.headers['X-Security-Proof']).toBe('fixture-proof')
      posts.push(JSON.parse(request.data))
      data = { saved: true }
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config: request }
  }
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('tab', { name: '用量记录' }))
  await screen.findByText('request-one')
  expect(await screen.findByText('reviewed quota')).toBeTruthy()
  const pagination = screen.getAllByRole('navigation', { name: '记录分页' })[0]
  fireEvent.click(within(pagination).getByRole('button', { name: '下一步' }))
  await waitFor(() => expect(pages).toContain(2))
  await screen.findByText('request-one')
  fireEvent.click(screen.getByRole('button', { name: '确认成功' }))
  const confirm = await screen.findByRole('button', { name: '确认对账' })
  expect(confirm.hasAttribute('disabled')).toBe(true)
  fireEvent.change(screen.getByLabelText('调整原因'), {
    target: { value: 'Verified upstream result' },
  })
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(posts).toEqual([
      {
        section: 'reconcile',
        user_id: 9,
        request_id: 'request-one',
        outcome: 'success',
        reason: 'Verified upstream result',
      },
    ])
  )
  expect(verify).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: 'admin.user.managed_config',
      context: expect.objectContaining({
        section: 'reconcile',
        request_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    })
  )
}, 20000)

it('provides default caps and translated friendly model selection in trial settings', async () => {
  installFixture()
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('tab', { name: '试用设置' }))
  expect(
    ((await screen.findByLabelText('每个账号同时调用上限')) as HTMLInputElement)
      .value
  ).toBe('1')
  expect(
    (screen.getByLabelText('每个账号每分钟调用上限') as HTMLInputElement).value
  ).toBe('5')
  expect(
    (screen.getByLabelText('全站同时调用上限') as HTMLInputElement).value
  ).toBe('4')
  expect(screen.getByRole('combobox', { name: '默认模型' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  expect(
    await screen.findByRole('combobox', { name: 'Default model' })
  ).toBeTruthy()
})

it('preserves WeChat, DingTalk and email drafts across navigation, language changes and refresh', async () => {
  installFixture({
    ...config,
    login_providers: [
      {
        provider: 'wechat',
        app_id: '',
        configured: false,
        enabled: false,
        callback: 'https://fixture.example/wechat',
      },
      {
        provider: 'dingtalk',
        app_id: '',
        configured: false,
        enabled: false,
        callback: 'https://fixture.example/dingtalk',
      },
    ],
  })
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  expect(document.querySelector('#wechat-secret')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: '登录方式' }))
  const wechatId = document.querySelector('#wechat-id') as HTMLInputElement
  const wechatSecret = document.querySelector(
    '#wechat-secret'
  ) as HTMLInputElement
  const dingtalkSecret = document.querySelector(
    '#dingtalk-secret'
  ) as HTMLInputElement
  const mailServer = document.querySelector('#smtp-server') as HTMLInputElement
  const mailSecret = document.querySelector('#smtp-secret') as HTMLInputElement
  fireEvent.change(wechatId, { target: { value: 'fixture-app-id' } })
  fireEvent.change(wechatSecret, { target: { value: 'fixture-wechat-draft' } })
  fireEvent.change(dingtalkSecret, {
    target: { value: 'fixture-dingtalk-draft' },
  })
  fireEvent.change(mailServer, { target: { value: 'smtp.fixture.example' } })
  fireEvent.change(mailSecret, { target: { value: 'fixture-mail-draft' } })
  fireEvent.click(screen.getByRole('tab', { name: '账号管理' }))
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  fireEvent.click(await screen.findByRole('tab', { name: 'Sign-in methods' }))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(wechatId.value).toBe('fixture-app-id')
  expect(wechatSecret.value).toBe('fixture-wechat-draft')
  expect(dingtalkSecret.value).toBe('fixture-dingtalk-draft')
  expect(mailServer.value).toBe('smtp.fixture.example')
  expect(mailSecret.value).toBe('fixture-mail-draft')
  expect(screen.getAllByLabelText('Application ID')).toHaveLength(2)
  expect(screen.getByLabelText('Email server')).toBeTruthy()
  for (let index = 0; index < localStorage.length; index++) {
    expect(
      localStorage.getItem(localStorage.key(index) || '') || ''
    ).not.toContain('draft')
  }
})

it('prioritizes the native disabled state and prevents grant saves until that account is enabled', async () => {
  api.defaults.adapter = async (request) => {
    let data = fixtureData(request.url || '', request.params)
    if (request.url?.endsWith('/accounts')) {
      data = {
        items: [
          {
            user_id: 9,
            display_name: '停用账号',
            native_status: 2,
            status: 'enabled',
            limit: 20,
            used: 1,
            reserved: 0,
            expires_at: 1900000000,
            model: '',
          },
        ],
        total: 1,
        page: 1,
      }
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config: request }
  }
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('tab', { name: '账号管理' }))
  expect(await screen.findByText('主账号系统已停用')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  expect(
    screen.getByText(
      '此账号已在主账号系统中停用。请先在主账号系统启用，再修改模型授权。'
    )
  ).toBeTruthy()
  fireEvent.change(screen.getByLabelText('调整原因'), {
    target: { value: 'fixture reason' },
  })
  expect(
    screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')
  ).toBe(true)
  expect(
    screen
      .getByRole('button', { name: '保存并撤销登录' })
      .hasAttribute('disabled')
  ).toBe(true)
})

const catalog = [
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    category: 'domestic',
    base_url: 'https://api.deepseek.com',
    upstream_model: 'deepseek-chat',
    credential_format: 'API Key',
    required_fields: [],
    setup_url: 'https://api-docs.deepseek.com/',
  },
  {
    provider: 'qwen',
    name: 'Qwen',
    category: 'domestic',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode',
    upstream_model: 'qwen-plus',
    credential_format: 'API Key',
    required_fields: [],
    setup_url: 'https://help.aliyun.com/',
  },
]
const connection = {
  connection_id: 7,
  provider: 'deepseek',
  name: 'Saved API',
  model_id: 'managed-7',
  base_url: 'https://api.deepseek.com',
  upstream_model: 'deepseek-chat',
  api_version: '',
  region: '',
  account_id: '',
  configured: true,
  enabled: true,
  ready: true,
  is_default: true,
  revision: 2,
  test_status: 'success',
  tested_at: 1,
}
async function modelView() {
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  fireEvent.click(
    await screen.findByRole('tab', { name: 'Model configuration' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
}
it('keeps separate API drafts through navigation and submits one exact-body proof without default selection', async () => {
  allowProtectedSave()
  const posts: string[] = []
  api.defaults.adapter = async (request) => {
    let data: unknown = fixtureData(request.url || '', request.params, {
      ...config,
      model_catalog: catalog,
      model_connections: [connection],
    })
    if (request.method === 'post') {
      posts.push(request.data)
      data = {
        saved: true,
        tested: true,
        connection_id: 8,
        model_connections: [
          connection,
          {
            ...connection,
            connection_id: 8,
            name: 'API 2',
            is_default: false,
            revision: 1,
          },
        ],
      }
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config: request }
  }
  renderAdmin()
  await modelView()
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'first-draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add API' }))
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'second-draft' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'API connection' }), {
    target: { value: 'saved-7' },
  })
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'first-draft'
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'API connection' }), {
    target: { value: 'draft-1' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Account management' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Model configuration' }))
  fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'second-draft'
  )
  const saveButton = screen.getByRole('button', { name: 'Save and test' })
  fireEvent.click(saveButton)
  fireEvent.click(saveButton)
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(JSON.parse(posts[0])).toMatchObject({
    section: 'model_connection',
    action: 'save',
    connection_id: 0,
    provider: 'deepseek',
    secret: 'second-draft',
    test_after_save: true,
  })
  expect(JSON.parse(posts[0]).make_default).toBeUndefined()
  const hash = Buffer.from(
    await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(posts[0]))
  ).toString('hex')
  expect(verify).toHaveBeenCalledWith(
    expect.objectContaining({
      context: { section: 'model_connection', request_hash: hash },
    })
  )
  await waitFor(() =>
    expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
      ''
    )
  )
  expect(
    (
      screen.getByRole('combobox', {
        name: 'API connection',
      }) as HTMLSelectElement
    ).value
  ).toBe('saved-8')
  fireEvent.change(screen.getByRole('combobox', { name: 'API connection' }), {
    target: { value: 'saved-7' },
  })
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'first-draft'
  )
})
it('omits blank secrets and retains drafts when save is unconfirmed', async () => {
  allowProtectedSave()
  const posts: Record<string, unknown>[] = []
  api.defaults.adapter = async (request) => {
    if (request.method === 'post') {
      posts.push(JSON.parse(request.data))
      throw new Error('network')
    }
    return {
      data: fixtureData(request.url || '', request.params, {
        ...config,
        model_catalog: catalog,
        model_connections: [connection],
      }),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  renderAdmin()
  await modelView()
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0]).not.toHaveProperty('secret')
  expect(posts[0]).toMatchObject({ connection_id: 7, revision: 2 })
  await waitFor(() =>
    expect(
      screen.getAllByText(
        'Save could not be confirmed. Refresh configuration and review before retrying.'
      ).length
    ).toBeGreaterThan(0)
  )
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'keep-on-error' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'keep-on-error'
  )
})
it('shows login configured separately from enabled and shows native registration status', async () => {
  installFixture({
    ...config,
    login_providers: [
      {
        provider: 'wechat',
        app_id: 'app',
        configured: true,
        enabled: false,
        callback: 'https://example.test/oauth',
      },
      {
        provider: 'dingtalk',
        app_id: '',
        configured: false,
        enabled: false,
        callback: 'https://example.test/ding',
      },
    ],
    smtp: {
      configured: true,
      enabled: true,
      registration_enabled: false,
      email_verification: true,
    },
  })
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  fireEvent.click(await screen.findByRole('tab', { name: 'Sign-in methods' }))
  expect(screen.getByRole('article', { name: 'WeChat' }).textContent).toContain(
    'Configured but disabled'
  )
  expect(
    screen.getByRole('article', { name: 'DingTalk' }).textContent
  ).toContain('Not configured')
  expect(
    screen.getByRole('article', { name: 'Email sign-in' }).textContent
  ).toContain('Registration disabled')
})
it('loads daily filters and displays historical upstream labels without current configuration relabeling', async () => {
  const requests: Record<string, unknown>[] = []
  api.defaults.adapter = async (request) => {
    if (request.url?.endsWith('/usage-daily')) requests.push(request.params)
    return {
      data: fixtureData(request.url || '', request.params, {
        ...config,
        model_connections: [{ ...connection, upstream_model: 'new-model' }],
      }),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  await screen.findByRole('combobox', { name: 'Usage model filter' })
  expect(screen.getAllByText('old-model').length).toBeGreaterThan(0)
  expect(screen.queryByText('new-model')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '30 days' }))
  await screen.findByRole('option', { name: /old-model.*managed-7/ })
  fireEvent.change(
    screen.getByRole('combobox', { name: 'Usage model filter' }),
    {
      target: { value: 'managed-7' },
    }
  )
  await waitFor(() =>
    expect(requests).toContainEqual({ days: 30, model: 'managed-7' })
  )
})

it('reports saved-but-failed creation by its returned ID and clears only the confirmed credential draft', async () => {
  allowProtectedSave()
  const posts: Record<string, unknown>[] = []
  let connections: (typeof connection)[] = []
  api.defaults.adapter = async (request) => {
    if (request.method === 'post') {
      posts.push(JSON.parse(request.data))
      connections = [
        {
          ...connection,
          connection_id: 19,
          name: 'API 1',
          is_default: false,
          ready: false,
          test_status: 'failed',
        },
      ]
      throw new AxiosError(
        'fixture failed test',
        'ERR_BAD_REQUEST',
        request,
        undefined,
        {
          data: {
            saved: true,
            tested: false,
            connection_id: 19,
            model_connections: connections,
          },
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config: request,
        }
      )
    }
    return {
      data: fixtureData(request.url || '', request.params, {
        ...config,
        model_catalog: catalog,
        model_connections: connections,
      }),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  fireEvent.click(
    await screen.findByRole('tab', { name: 'Model configuration' })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Configure Qwen' }))
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'qwen-retained-draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'confirmed-secret' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  await waitFor(() =>
    expect(
      (
        screen.getByRole('combobox', {
          name: 'API connection',
        }) as HTMLSelectElement
      ).value
    ).toBe('saved-19')
  )
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    ''
  )
  expect(
    screen
      .getByRole('button', { name: 'Use this API' })
      .hasAttribute('disabled')
  ).toBe(true)
  expect(
    within(screen.getByRole('dialog')).getByText(
      'Configuration saved, but the connection test failed. Review the settings and test again.'
    )
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  fireEvent.click(screen.getByRole('button', { name: 'Configure Qwen' }))
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'qwen-retained-draft'
  )
  expect(posts).toHaveLength(1)
})
it('selects the exact ready saved API explicitly and deletes only a confirmed nondefault API', async () => {
  allowProtectedSave()
  const posts: Record<string, unknown>[] = []
  let connections = [
    connection,
    {
      ...connection,
      connection_id: 8,
      name: 'Second API',
      model_id: 'managed-8',
      is_default: false,
    },
  ]
  api.defaults.adapter = async (request) => {
    let data: unknown = fixtureData(request.url || '', request.params, {
      ...config,
      model_catalog: catalog,
      model_connections: connections,
    })
    if (request.method === 'post') {
      const body = JSON.parse(request.data)
      posts.push(body)
      if (body.action === 'select') {
        connections = connections.map((row) => ({
          ...row,
          is_default: row.connection_id === body.connection_id,
        }))
      }
      if (body.action === 'delete') {
        connections = connections.filter(
          (row) => row.connection_id !== body.connection_id
        )
      }
      data = {
        saved: true,
        tested: false,
        connection_id: body.connection_id,
        model_connections: connections,
      }
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config: request }
  }
  renderAdmin()
  await modelView()
  fireEvent.change(screen.getByRole('combobox', { name: 'API connection' }), {
    target: { value: 'saved-8' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Use this API' }))
  await waitFor(() =>
    expect(posts[0]).toEqual({
      section: 'model_connection',
      action: 'select',
      provider: 'deepseek',
      connection_id: 8,
      revision: 2,
    })
  )
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Use this API' })
        .hasAttribute('disabled')
    ).toBe(true)
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'API connection' }), {
    target: { value: 'saved-7' },
  })
  fireEvent.click(screen.getByText('More settings (usually unchanged)'))
  fireEvent.click(screen.getByRole('button', { name: 'Delete this API' }))
  expect(posts).toHaveLength(1)
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete this API',
    })
  )
  await waitFor(() =>
    expect(posts[1]).toEqual({
      section: 'model_connection',
      action: 'delete',
      provider: 'deepseek',
      connection_id: 7,
      revision: 2,
    })
  )
})
it('preserves unknown daily usage and provides empty/error recovery and responsive navigation state', async () => {
  let fail = true
  api.defaults.adapter = async (request) => {
    if (request.url?.endsWith('/usage-daily') && fail) {
      throw new Error('fixture unavailable')
    }
    return {
      data: request.url?.endsWith('/usage-daily')
        ? {
            days: 7,
            model: '',
            today: { ...totals, requests: 0 },
            totals: { ...totals, requests: 0, total_tokens: 0 },
            items: [],
            model_options: [],
          }
        : fixtureData(request.url || '', request.params),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  await screen.findByText('Unable to load daily usage')
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText(
    'No client model requests in this period. Usage will appear after a real client request.'
  )
  const menu = screen.getByRole('button', { name: 'Open navigation' })
  fireEvent.click(menu)
  expect(menu.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(screen.getByRole('tab', { name: 'Model configuration' }))
  expect(menu.getAttribute('aria-expanded')).toBe('false')
})

it('never treats a historical successful test as ready after native channel disablement', async () => {
  installFixture({
    ...config,
    model_catalog: catalog,
    model_connections: [
      { ...connection, ready: false, test_status: 'success', is_default: true },
    ],
  })
  renderAdmin()
  await modelView()
  expect(
    within(screen.getByRole('dialog')).getByText(
      /Current default.*Awaiting connection test/
    )
  ).toBeTruthy()
  expect(
    screen
      .getByRole('button', { name: 'Use this API' })
      .hasAttribute('disabled')
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(
    within(screen.getByRole('article', { name: 'DeepSeek' })).getByText(
      'Awaiting connection test'
    )
  ).toBeTruthy()
})

it('shows required native platform fields and preserves multiline credentials only in memory', async () => {
  installFixture({
    ...config,
    model_catalog: [
      {
        provider: 'vertex',
        name: 'Vertex AI',
        category: 'platform',
        base_url: 'https://aiplatform.googleapis.com',
        upstream_model: '',
        credential_format:
          'Service account JSON (project_id, client_email, private_key); fixed Google OAuth token endpoint',
        required_fields: [
          'name',
          'secret',
          'base_url',
          'upstream_model',
          'region',
        ],
        setup_url: 'https://cloud.google.com/vertex-ai/docs',
      },
    ],
    model_connections: [],
  })
  renderAdmin()
  await screen.findByRole('heading', { name: '灵兔 AI 管理后台' })
  fireEvent.click(screen.getByRole('button', { name: 'English' }))
  fireEvent.click(
    await screen.findByRole('tab', { name: 'Model configuration' })
  )
  fireEvent.click(screen.getByText(/Other models and platforms/))
  fireEvent.click(screen.getByRole('button', { name: 'Configure Vertex AI' }))
  expect(screen.getByLabelText('Region')).toBeTruthy()
  const credential = screen.getByLabelText('Model key') as HTMLTextAreaElement
  const secret = '{\n"type":"service_account",\n"project_id":"fixture"\n}'
  fireEvent.change(credential, { target: { value: secret } })
  expect(credential.value).toBe(secret)
  expect(credential.classList.contains('secret-masked')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Show' }))
  expect(credential.classList.contains('secret-masked')).toBe(false)
  expect(screen.getByLabelText('Upstream model ID')).toBeTruthy()
  for (let index = 0; index < localStorage.length; index++) {
    expect(localStorage.getItem(localStorage.key(index) || '')).not.toContain(
      'service_account'
    )
  }
})

it('recovers a committed response-lost existing API only after explicit confirmed reload and preserves other drafts', async () => {
  allowProtectedSave()
  const posts: Record<string, unknown>[] = []
  let current = { ...connection }
  api.defaults.adapter = async (request) => {
    if (request.method === 'post') {
      const body = JSON.parse(request.data)
      posts.push(body)
      if (posts.length === 1) {
        current = {
          ...current,
          name: 'Committed server API',
          revision: 3,
          ready: false,
          test_status: 'never',
        }
        throw new Error('response lost after commit')
      }
      if (body.revision !== current.revision) {
        throw new AxiosError('stale', 'ERR_BAD_REQUEST', request, undefined, {
          data: { error: 'configuration_update_failed' },
          status: 400,
          statusText: 'Bad Request',
          headers: {},
          config: request,
        })
      }
      current = { ...current, name: String(body.name), revision: 4 }
      return {
        data: {
          saved: true,
          tested: true,
          connection_id: 7,
          model_connections: [current],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: request,
      }
    }
    return {
      data: fixtureData(request.url || '', request.params, {
        ...config,
        model_catalog: catalog,
        model_connections: [current],
      }),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  renderAdmin()
  await modelView()
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'keep-until-confirmed' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add API' }))
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'other-api-secret' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'API connection' }), {
    target: { value: 'saved-7' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  await screen.findByRole('button', { name: 'Reload saved API' })
  expect(posts).toHaveLength(1)
  expect(posts[0].revision).toBe(2)
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'keep-until-confirmed'
  )
  expect(
    screen
      .getByRole('button', { name: 'Save and test' })
      .hasAttribute('disabled')
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  expect(posts).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'keep-until-confirmed'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved API' }))
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Cancel',
    })
  )
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'keep-until-confirmed'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved API' }))
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Discard this draft and reload',
    })
  )
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    ''
  )
  fireEvent.click(screen.getByText('More settings (usually unchanged)'))
  expect((screen.getByLabelText('API name') as HTMLInputElement).value).toBe(
    'Committed server API'
  )
  fireEvent.change(screen.getByLabelText('API name'), {
    target: { value: 'Reviewed and edited' },
  })
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'new-reviewed-secret' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[1]).toMatchObject({
    connection_id: 7,
    revision: 3,
    name: 'Reviewed and edited',
    secret: 'new-reviewed-secret',
  })
  await waitFor(() =>
    expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
      ''
    )
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'API connection' }), {
    target: { value: 'draft-1' },
  })
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'other-api-secret'
  )
})

it('warns about unconfirmed creation and reviews saved APIs without guessing the new ID or discarding its secret', async () => {
  allowProtectedSave()
  let connections: (typeof connection)[] = []
  const posts: Record<string, unknown>[] = []
  api.defaults.adapter = async (request) => {
    if (request.method === 'post') {
      posts.push(JSON.parse(request.data))
      connections = [
        { ...connection, connection_id: 29, name: 'API 1', is_default: false },
      ]
      throw new Error('created but response lost')
    }
    return {
      data: fixtureData(request.url || '', request.params, {
        ...config,
        model_catalog: catalog,
        model_connections: connections,
      }),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  renderAdmin()
  await modelView()
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'unconfirmed-creation-secret' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  await screen.findByText(
    'A new API may already have been saved. Review saved APIs before creating another. No connection is matched automatically.'
  )
  expect(
    (
      screen.getByRole('combobox', {
        name: 'API connection',
      }) as HTMLSelectElement
    ).value
  ).toBe('draft-1')
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'unconfirmed-creation-secret'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Review saved APIs' }))
  expect(
    (
      screen.getByRole('combobox', {
        name: 'API connection',
      }) as HTMLSelectElement
    ).value
  ).toBe('draft-1')
  expect(screen.getAllByRole('option', { name: /API 1/ })).toHaveLength(2)
  fireEvent.change(screen.getByRole('combobox', { name: 'API connection' }), {
    target: { value: 'saved-29' },
  })
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    ''
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'API connection' }), {
    target: { value: 'draft-1' },
  })
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'unconfirmed-creation-secret'
  )
  expect(posts).toHaveLength(1)
})

it('allows retry after canceled verification and known rejected creation without discarding its credential', async () => {
  allowProtectedSave()
  verify.mockResolvedValueOnce(null)
  let attempts = 0
  let connections: (typeof connection)[] = []
  api.defaults.adapter = async (request) => {
    if (request.method === 'post') {
      attempts++
      if (attempts === 1)
        {throw new AxiosError(
          'validation',
          'ERR_BAD_REQUEST',
          request,
          undefined,
          {
            data: { error: 'configuration_update_failed' },
            status: 400,
            statusText: 'Bad Request',
            headers: {},
            config: request,
          }
        )}
      connections = [{ ...connection, connection_id: 39, is_default: false }]
      return {
        data: {
          saved: true,
          tested: true,
          connection_id: 39,
          model_connections: connections,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: request,
      }
    }
    return {
      data: fixtureData(request.url || '', request.params, {
        ...config,
        model_catalog: catalog,
        model_connections: connections,
      }),
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  renderAdmin()
  await modelView()
  fireEvent.change(screen.getByLabelText('Model key'), {
    target: { value: 'retryable-secret' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Save and test' })
        .hasAttribute('disabled')
    ).toBe(false)
  )
  expect(attempts).toBe(0)
  expect(screen.queryByRole('button', { name: 'Review saved APIs' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  await waitFor(() => expect(attempts).toBe(1))
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Save and test' })
        .hasAttribute('disabled')
    ).toBe(false)
  )
  expect((screen.getByLabelText('Model key') as HTMLInputElement).value).toBe(
    'retryable-secret'
  )
  expect(screen.queryByRole('button', { name: 'Review saved APIs' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save and test' }))
  await waitFor(() =>
    expect(
      (
        screen.getByRole('combobox', {
          name: 'API connection',
        }) as HTMLSelectElement
      ).value
    ).toBe('saved-39')
  )
  expect(attempts).toBe(2)
})
