import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { CostRecordCell } from './admin-cost-record'
import {
  AdminModels,
  type ModelConnection,
  type ModelSave,
} from './admin-models'
import { AccountUsageSummary, AdminOverview } from './admin-usage'
import { formatCostMicros, validCostPrice } from './cost-display'

const adapter = api.defaults.adapter
beforeEach(async () => {
  await i18next.changeLanguage('en')
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
})
afterEach(() => {
  cleanup()
  api.defaults.adapter = adapter
  vi.restoreAllMocks()
})
const provider = {
  provider: 'deepseek',
  name: 'DeepSeek',
  category: 'domestic',
  base_url: 'https://api.deepseek.com',
  upstream_model: 'deepseek-chat',
  credential_format: 'API Key',
  required_fields: ['name', 'secret', 'base_url', 'upstream_model'],
  setup_url: 'https://platform.deepseek.com',
}
const connection: ModelConnection = {
  connection_id: 7,
  provider: 'deepseek',
  name: 'Primary',
  model_id: 'managed-7',
  base_url: provider.base_url,
  upstream_model: provider.upstream_model,
  api_version: '',
  region: '',
  account_id: '',
  configured: true,
  enabled: true,
  ready: true,
  is_default: true,
  revision: 1,
  test_status: 'success',
  tested_at: 1,
  cost_rate_model: 'deepseek-chat',
}
function wrapper(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  )
}
it('saves exact CNY prices, preserves explicit zero and clears blank prices', async () => {
  const save = vi.fn<ModelSave>(async () => false)
  render(
    <AdminModels
      catalog={[provider]}
      connections={[connection]}
      save={save}
      busy={false}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
  fireEvent.click(screen.getByText('More settings (usually unchanged)'))
  fireEvent.change(
    screen.getByLabelText('Input price (CNY / million tokens)'),
    { target: { value: '2.000001' } }
  )
  fireEvent.change(
    screen.getByLabelText('Output price (CNY / million tokens)'),
    { target: { value: '0' } }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save without testing' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        cost_rates: {
          input_cny: '2.000001',
          output_cny: '0',
          cache_read_cny: null,
        },
      })
    )
  )
})
it('loads prices into the correct connection draft and rejects malformed prices before saving', async () => {
  const save = vi.fn<ModelSave>(async () => false)
  const priced = {
    ...connection,
    input_cny: '2.5',
    output_cny: '8',
    cache_read_cny: '0.2',
  }
  render(
    <AdminModels
      catalog={[provider]}
      connections={[priced]}
      save={save}
      busy={false}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
  fireEvent.click(screen.getByText('More settings (usually unchanged)'))
  expect(
    (
      screen.getByLabelText(
        'Input price (CNY / million tokens)'
      ) as HTMLInputElement
    ).value
  ).toBe('2.5')
  fireEvent.change(
    screen.getByLabelText('Input price (CNY / million tokens)'),
    { target: { value: '-1' } }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save without testing' }))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toContain(
    'Prices must be between 0 and 1000000 CNY with at most 6 decimal places.'
  )
})
const totals = {
  requests: 2,
  successes: 1,
  failed: 1,
  uncertain: 0,
  input_tokens: 100,
  output_tokens: 20,
  total_tokens: 120,
  unknown_usage: 0,
  cost_micros: 1,
  unknown_cost_requests: 1,
}
it('shows the known microyuan subtotal and unknown cost count for account and daily summaries', async () => {
  api.defaults.adapter = async (request) => ({
    data: request.url?.endsWith('/usage-daily')
      ? {
          totals,
          today: totals,
          days: 7,
          model: '',
          model_options: [],
          items: [],
        }
      : {
          totals,
          items: [
            { ...totals, user_id: 9, display_name: 'Account', last_used_at: 1 },
          ],
          page: 1,
          total: 1,
        },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: request,
  })
  wrapper(
    <>
      <AdminOverview onManageAccounts={() => {}} onViewUsage={() => {}} />
      <AccountUsageSummary onViewUser={() => {}} />
    </>
  )
  await waitFor(() =>
    expect(
      screen.getAllByText(/Known cost subtotal \(CNY\)/).length
    ).toBeGreaterThan(1)
  )
  expect(screen.getAllByText(/¥0\.000001/).length).toBeGreaterThan(1)
  expect(screen.getAllByText(/Unpriced requests/).length).toBeGreaterThan(1)
})

it('persists the optional cache price and clears every model-specific price when the model changes', async () => {
  const save = vi.fn<ModelSave>(async () => false)
  render(
    <AdminModels
      catalog={[provider]}
      connections={[
        {
          ...connection,
          input_cny: '2',
          output_cny: '8',
          cache_read_cny: '0.5',
        },
      ]}
      save={save}
      busy={false}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Configure DeepSeek' }))
  fireEvent.click(screen.getByText('More settings (usually unchanged)'))
  expect(
    (
      screen.getByLabelText(
        'Cache read price (CNY / million tokens, optional)'
      ) as HTMLInputElement
    ).value
  ).toBe('0.5')
  fireEvent.change(
    screen.getByLabelText('Cache read price (CNY / million tokens, optional)'),
    { target: { value: '0' } }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save without testing' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        cost_rates: { input_cny: '2', output_cny: '8', cache_read_cny: '0' },
      })
    )
  )
  fireEvent.change(screen.getByLabelText('Upstream model ID'), {
    target: { value: 'next-model' },
  })
  for (const label of [
    'Input price (CNY / million tokens)',
    'Output price (CNY / million tokens)',
    'Cache read price (CNY / million tokens, optional)',
  ]) {
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('')
  }
})
it('shows stored microyuan and historical cache prices, and never promotes unknown zero into a free call', () => {
  render(
    <>
      <CostRecordCell
        row={{
          cost_known: true,
          cost_micros: 1,
          cost_status: 'estimated',
          cost_input_cny: '2',
          cost_output_cny: '8',
          cost_cache_read_cny: '0',
          cache_usage_known: true,
          cache_read_tokens: 0,
        }}
      />
      <CostRecordCell
        row={{
          cost_known: false,
          cost_micros: 0,
          cost_status: 'cache_usage_unknown',
          estimated_cny: '0',
        }}
      />
    </>
  )
  expect(screen.getByText('¥0.000001')).toBeTruthy()
  expect(screen.getByText('Admission price snapshot')).toBeTruthy()
  expect(
    screen.getByText(/Historical prices.*Input 2 \/ Output 8 \/ Cache read 0/)
  ).toBeTruthy()
  expect(screen.getByText('Cache read tokens: 0')).toBeTruthy()
  expect(
    screen.getByText('Cost unavailable: cache usage not returned')
  ).toBeTruthy()
  expect(screen.queryByText('¥0.000000')).toBeNull()
})
it('uses the selected 7/30-day response and keeps today cost separate from the selected-period cost', async () => {
  const periods: number[] = []
  api.defaults.adapter = async (request) => {
    const days = Number(request.params?.days || 7)
    periods.push(days)
    return {
      data: {
        totals: { ...totals, cost_micros: days },
        today: { ...totals, cost_micros: 1 },
        days,
        model: '',
        model_options: [],
        items: [],
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  wrapper(<AdminOverview onManageAccounts={() => {}} onViewUsage={() => {}} />)
  await screen.findByText(/Estimated cost.*¥0.000007/)
  expect(screen.getByText(/Today.*¥0.000001/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '30 days' }))
  await screen.findByText(/Estimated cost.*¥0.000030/)
  expect(periods).toEqual([7, 30])
})
it('shows the combined report estimate with separate snapshot and historical current-rate evidence', async () => {
  const rich = {
    ...totals,
    cost_micros: 1,
    estimated_cny: '0.000001',
    historical_cost_micros: 2,
    historical_estimated_cny: '0.000002',
    historical_costed_requests: 1,
    historical_unpriced_requests: 1,
    uncached_input_estimates: 1,
    report_cost_micros: 3,
    report_estimated_cny: '0.000003',
    report_costed_requests: 2,
    report_unpriced_requests: 1,
  }
  api.defaults.adapter = async (request) => ({
    data: {
      totals: rich,
      today: rich,
      this_month: rich,
      days: 7,
      period: 'day',
      model: '',
      model_options: [],
      items: [],
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: request,
  })
  wrapper(<AdminOverview onManageAccounts={() => {}} onViewUsage={() => {}} />)
  await screen.findByText(/Estimated cost \(CNY\): ¥0\.000003/)
  expect(screen.getByText(/Admission price snapshot: ¥0\.000001/)).toBeTruthy()
  expect(
    screen.getByText(/Historical current-rate estimate: ¥0\.000002/)
  ).toBeTruthy()
  expect(
    screen.getByText(/1 calls estimated at input price without cache detail/)
  ).toBeTruthy()
  expect(screen.getByText(/This month: ¥0\.000003/)).toBeTruthy()
  expect(screen.getByText(/Today.*¥0\.000003/)).toBeTruthy()
  expect(screen.getByText('Aggregate amount by period')).toBeTruthy()
  expect(screen.getByLabelText('Cost estimate by period')).toBeTruthy()
})

it('switches to the 12-calendar-month view without losing the model filter or token chart', async () => {
  const requests: Record<string, unknown>[] = []
  api.defaults.adapter = async (request) => {
    requests.push(request.params)
    const monthly = request.params?.period === 'month'
    return {
      data: {
        totals: { ...totals, cost_micros: monthly ? 30 : 7 },
        today: { ...totals, cost_micros: 1 },
        this_month: { ...totals, cost_micros: 11 },
        period: monthly ? 'month' : 'day',
        days: monthly ? 0 : 7,
        months: monthly ? 12 : 0,
        model: '',
        model_options: ['managed-7'],
        items: [
          {
            ...totals,
            cost_micros: monthly ? 30 : 7,
            report_cost_micros: monthly ? 30 : 7,
            date: monthly ? '2026-11' : '2026-11-13',
            model: 'managed-7',
            channel_id: 7,
            channel_name: 'Historical API',
            upstream_model: 'old-model',
          },
        ],
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: request,
    }
  }
  wrapper(<AdminOverview onManageAccounts={() => {}} onViewUsage={() => {}} />)
  await screen.findByText(/Estimated cost \(CNY\): ¥0\.000007/)
  fireEvent.click(screen.getByRole('button', { name: 'Monthly view' }))
  await waitFor(() =>
    expect(requests).toContainEqual({ period: 'month' })
  )
  await screen.findByText(/Estimated cost \(CNY\): ¥0\.000030/)
  expect(
    screen.getByRole('button', { name: 'Monthly view' }).getAttribute('aria-pressed')
  ).toBe('true')
  expect(screen.getByRole('combobox', { name: 'Usage model filter' })).toBeTruthy()
  expect(screen.getByText('Monthly token usage')).toBeTruthy()
  expect(screen.getAllByText('2026-11').length).toBeGreaterThan(0)
  expect(screen.getByText('Aggregate amount by period')).toBeTruthy()
  expect(screen.getByLabelText('Cost estimate by period')).toBeTruthy()
  expect(requests[0]).toEqual({ days: 7 })
})
it('preserves six-decimal money precision and rejects unsafe or malformed input', () => {
  expect(formatCostMicros(0)).toBe('¥0.000000')
  expect(formatCostMicros(Number.MAX_SAFE_INTEGER + 1)).toBe('—')
  expect(formatCostMicros(1000001)).toBe('¥1.000001')
  for (const value of ['-1', '1e3', '1.0000001', '1000000.000001', '01']) {
    expect(validCostPrice(value)).toBe(false)
  }
  for (const value of ['', '0', '0.000001', '1000000.000000']) {
    expect(validCostPrice(value)).toBe(true)
  }
})

it('shows unpriced reports as unknown rather than free when no call can be estimated', async () => {
 const unpriced = {...totals, requests: 2, cost_micros: 0, costed_requests: 0, historical_cost_micros: 0, historical_costed_requests: 0, report_cost_micros: 0, report_costed_requests: 0, report_unpriced_requests: 2}
 api.defaults.adapter = async (request) => ({data: {totals: unpriced, today: unpriced, this_month: unpriced, days: 7, items: [], model_options: []}, status: 200, statusText: 'OK', headers: {}, config: request})
 wrapper(<AdminOverview onManageAccounts={() => {}} onViewUsage={() => {}} />)
 await screen.findByText(/Estimated cost \(CNY\): —/)
 expect(screen.getByText(/Today.*—/)).toBeTruthy()
 expect(screen.getByText(/This month.*—/)).toBeTruthy()
})
