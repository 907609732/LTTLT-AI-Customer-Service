import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { StaticDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { formatNumber, formatTimestamp } from '@/lib/format'

import { formatCNY } from './admin-cost-format'
import { formatCostMicros } from './cost-display'

function costSubtotal(totals: {
  costed_requests?: number
  cost_micros?: number
  estimated_cny?: string
}) {
  if (totals.costed_requests === 0) return '—'
  return totals.cost_micros === undefined
    ? formatCNY(totals.estimated_cny)
    : formatCostMicros(totals.cost_micros)
}

function historicalSubtotal(totals: {
  historical_costed_requests?: number
  historical_cost_micros?: number
  historical_estimated_cny?: string
}) {
  if (totals.historical_costed_requests === 0) return '—'
  return totals.historical_cost_micros === undefined
    ? formatCNY(totals.historical_estimated_cny)
    : formatCostMicros(totals.historical_cost_micros)
}

function reportSubtotal(totals: {
  report_costed_requests?: number
  report_unpriced_requests?: number
  report_cost_micros?: number
  report_estimated_cny?: string
  cost_micros?: number
  estimated_cny?: string
}) {
  if (totals.report_costed_requests === 0 && (totals.report_unpriced_requests ?? 0) > 0) return '—'
  if (totals.report_cost_micros !== undefined) {
    return formatCostMicros(totals.report_cost_micros)
  }
  if (totals.cost_micros !== undefined) {
    return formatCostMicros(totals.cost_micros)
  }
  return formatCNY(totals.report_estimated_cny ?? totals.estimated_cny)
}

export function CostSummary(props: {
  totals: {
    cost_micros?: number
    unknown_cost_requests?: number
    estimated_cny?: string
    costed_requests?: number
    unpriced_requests?: number
    current_rate_requests?: number
    historical_cost_micros?: number
    historical_estimated_cny?: string
    historical_costed_requests?: number
    historical_unpriced_requests?: number
    uncached_input_estimates?: number
    report_cost_micros?: number
    report_estimated_cny?: string
    report_costed_requests?: number
    report_unpriced_requests?: number
  }
}) {
  const { t } = useTranslation()
  const historicalVisible =
    props.totals.historical_cost_micros !== undefined ||
    props.totals.historical_estimated_cny !== undefined
  return (
    <div className='admin-help'>
      <strong>
        {t('Estimated cost (CNY)')}: {reportSubtotal(props.totals)}
      </strong>{' '}
      · {t('Costed requests')}:{' '}
      {formatNumber(
        props.totals.report_costed_requests ?? props.totals.costed_requests
      )}{' '}
      · {t('Unpriced requests')}:{' '}
      {formatNumber(
        props.totals.report_unpriced_requests ??
          props.totals.unknown_cost_requests ??
          props.totals.unpriced_requests
      )}{' '}
      · {t('Recalculated at current rates')}:{' '}
      {formatNumber(props.totals.historical_costed_requests ?? props.totals.current_rate_requests)}
      {historicalVisible && (
        <p>
          <span>
            {t('Admission price snapshot')}: {costSubtotal(props.totals)} ·{' '}
            {formatNumber(props.totals.costed_requests)}
          </span>
          <br />
          <span>
            {t('Historical current-rate estimate')}:{' '}
            {historicalSubtotal(props.totals)} ·{' '}
            {formatNumber(props.totals.historical_costed_requests)}
          </span>
          {(props.totals.uncached_input_estimates ?? 0) > 0 && (
            <>
              <br />
              <span>
                {formatNumber(props.totals.uncached_input_estimates)}{' '}
                {t('calls estimated at input price without cache detail')}
              </span>
            </>
          )}
        </p>
      )}
      <p>
        {t('Known cost subtotal (CNY)')} ·{' '}
        {t(
          'Configured-rate estimate only; not a supplier bill or balance deduction. Missing usage or prices remain unpriced.'
        )}
      </p>
      <p>
        {t(
          'Historical usage is estimated at current prices and shown separately from saved costs; unpriced calls are excluded.'
        )}
      </p>
    </div>
  )
}
function CostCell(props: { totals: UsageTotals }) {
  const { t } = useTranslation()
  return (
    <div>
      <strong>{reportSubtotal(props.totals)}</strong>
      <small className='block'>
        {t('Admission price snapshot')}: {costSubtotal(props.totals)} ·{' '}
        {t('Historical current-rate estimate')}:{' '}
        {historicalSubtotal(props.totals)}
      </small>
      <small className='block'>
        {t('Unpriced requests')}:{' '}
        {formatNumber(
          props.totals.report_unpriced_requests ??
            props.totals.unknown_cost_requests ??
            props.totals.unpriced_requests
        )}{' '}
        · {t('Recalculated at current rates')}:{' '}
        {formatNumber(props.totals.historical_costed_requests ?? props.totals.current_rate_requests)}
      </small>
    </div>
  )
}
interface UsageTotals {
  cost_micros?: number
  unknown_cost_requests?: number
  estimated_cny?: string
  costed_requests?: number
  unpriced_requests?: number
  current_rate_requests?: number
  historical_cost_micros?: number
  historical_estimated_cny?: string
  historical_costed_requests?: number
  historical_unpriced_requests?: number
  uncached_input_estimates?: number
  report_cost_micros?: number
  report_estimated_cny?: string
  report_costed_requests?: number
  report_unpriced_requests?: number
  requests: number
  successes: number
  failed: number
  uncertain: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  unknown_usage: number
}
interface AccountUsage extends UsageTotals {
  user_id: number
  display_name: string
  last_used_at: number
}
interface UsageSummary {
  totals: UsageTotals
  items: AccountUsage[]
  total: number
  page: number
}
function useUsageSummary(page: number, userId?: number) {
  return useQuery({
    queryKey: ['lingtu', 'usage-summary', page, userId ?? null],
    queryFn: async () =>
      (
        await api.get<UsageSummary>('/api/lingtu/admin/usage-summary', {
          params: { page, ...(userId ? { user_id: userId } : {}) },
        })
      ).data,
  })
}
function TotalsCards(props: { totals: UsageTotals; accounts?: number }) {
  const { t } = useTranslation()
  const cards: [string, number | undefined][] = [
    ['Total requests', props.totals.requests],
    ['Successful requests', props.totals.successes],
    ['Failed requests', props.totals.failed],
    ['Uncertain requests', props.totals.uncertain],
    ['Known input tokens', props.totals.input_tokens],
    ['Known output tokens', props.totals.output_tokens],
    ['Known total tokens', props.totals.total_tokens],
    ['Requests without usage', props.totals.unknown_usage],
  ]
  if (props.accounts !== undefined) {
    cards.unshift(['Registered accounts', props.accounts])
  }
  return (
    <>
      <CostSummary totals={props.totals} />
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {cards.map(([label, value]) => (
          <Card key={label} className='border border-blue-100 bg-white'>
            <CardHeader>
              <CardTitle className='text-sm text-slate-500'>
                {t(label)}
              </CardTitle>
            </CardHeader>
            <CardContent className='text-2xl font-semibold'>
              {formatNumber(value)}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
interface DailyUsageItem extends UsageTotals {
  date: string
  model: string
  channel_id: number
  channel_name: string
  upstream_model: string
}
interface DailyUsage {
  period?: 'day' | 'month'
  days: number
  months?: number
  model: string
  today: UsageTotals
  this_month?: UsageTotals
  totals: UsageTotals
  items: DailyUsageItem[]
  model_options: string[]
}
interface PeriodAmount {
  date: string
  requests: number
  input_tokens: number
  output_tokens: number
  snapshot: number
  historical: number
  report: number
  unpriced: number
}
function historicalModel(row: DailyUsageItem) {
  return (
    row.upstream_model || (!row.model.startsWith('managed-') ? row.model : '')
  )
}
const chartColors = [
  '#4679df',
  '#50a6c5',
  '#9e82d9',
  '#de9b52',
  '#63a58b',
  '#d27b98',
]
export function AdminOverview(props: {
  onManageAccounts: () => void
  onViewUsage: () => void
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<'day' | 'month'>('day')
  const [days, setDays] = useState<7 | 30>(7)
  const [model, setModel] = useState('')
  const query = useQuery({
    queryKey: ['lingtu', 'usage-daily', view, days, model],
    queryFn: async () =>
      (
        await api.get<DailyUsage>('/api/lingtu/admin/usage-daily', {
          params:
            view === 'month'
              ? { period: 'month', ...(model ? { model } : {}) }
              : { days, ...(model ? { model } : {}) },
        })
      ).data,
  })
  const amounts = useMemo(() => {
    const groups = new Map<string, PeriodAmount>()
    for (const row of query.data?.items || []) {
      const group = groups.get(row.date) || {
        date: row.date,
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        snapshot: 0,
        historical: 0,
        report: 0,
        unpriced: 0,
      }
      group.requests += row.requests
      group.input_tokens += row.input_tokens
      group.output_tokens += row.output_tokens
      group.snapshot += row.cost_micros ?? 0
      group.historical += row.historical_cost_micros ?? 0
      group.report +=
        row.report_cost_micros ?? row.cost_micros ?? row.historical_cost_micros ?? 0
      group.unpriced +=
        row.report_unpriced_requests ??
        row.unknown_cost_requests ??
        row.unpriced_requests ??
        0
      groups.set(row.date, group)
    }
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date))
  }, [query.data])
  const chart = useMemo(() => {
    const items = query.data?.items || []
    const names = [
      ...new Set(items.filter((row) => row.requests > 0).map(historicalModel)),
    ].sort()
    const keys = new Map(names.map((name, i) => [name, `series${i}`]))
    const dates = new Map<string, Record<string, string | number>>()
    const ranks = new Map<
      string,
      { name: string; tokens: number; requests: number; unknown: number }
    >()
    for (const row of items) {
      const date = dates.get(row.date) || {
        date: row.date,
        input: 0,
        output: 0,
      }
      date.input = Number(date.input) + row.input_tokens
      date.output = Number(date.output) + row.output_tokens
      const key = keys.get(historicalModel(row))
      if (key) date[key] = Number(date[key] || 0) + row.total_tokens
      dates.set(row.date, date)
      if (row.requests > 0) {
        const rank = ranks.get(historicalModel(row)) || {
          name: historicalModel(row),
          tokens: 0,
          requests: 0,
          unknown: 0,
        }
        rank.tokens += row.total_tokens
        rank.requests += row.requests
        rank.unknown += row.unknown_usage
        ranks.set(historicalModel(row), rank)
      }
    }
    return {
      names,
      data: [...dates.values()],
      ranks: [...ranks.values()].sort((a, b) => b.tokens - a.tokens),
      keys,
    }
  }, [query.data])
  function optionLabel(value: string) {
    const names = [
      ...new Set(
        (query.data?.items || [])
          .filter((row) => row.model === value && row.requests > 0)
          .map(
            (row) =>
              `${historicalModel(row) || t('Unknown model')} / ${row.channel_name || t('Unknown API')}`
          )
      ),
    ]
    return names.length ? `${names.join(' · ')} (${value})` : value
  }
  const totals = query.data?.totals
  return (
    <section className='space-y-5' aria-label={t('Service overview')}>
      <div className='overview-toolbar'>
        <p className='admin-intro'>
          {t(
            view === 'month'
              ? 'Actual client usage by Beijing natural month. Missing usage is counted separately and never estimated.'
              : 'Actual client usage by Beijing natural day. Missing usage is counted separately and never estimated.'
          )}
        </p>
        <div className='daily-chart-controls'>
          <div role='group' aria-label={t('Usage view')}>
            {(
              [
                ['day', 'Daily view'],
                ['month', 'Monthly view'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant={view === value ? 'secondary' : 'ghost'}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {t(label)}
              </Button>
            ))}
          </div>
          {view === 'day' ? (
            <div role='group' aria-label={t('Usage period')}>
              {([7, 30] as const).map((value) => (
                <Button
                  key={value}
                  variant={days === value ? 'secondary' : 'ghost'}
                  aria-pressed={days === value}
                  onClick={() => setDays(value)}
                >
                  {t(value === 7 ? '7 days' : '30 days')}
                </Button>
              ))}
            </div>
          ) : (
            <span className='admin-help'>
              {t('Last 12 months')} · {t('Beijing time')}
            </span>
          )}
          <Label htmlFor='usage-model-filter'>{t('Model')}</Label>
          <select
            id='usage-model-filter'
            aria-label={t('Usage model filter')}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value=''>{t('All models')}</option>
            {[
              ...new Set([
                ...(query.data?.model_options || []),
                ...(model ? [model] : []),
              ]),
            ].map((value) => (
              <option key={value} value={value}>
                {optionLabel(value)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {query.isPending && <p role='status'>{t('Loading daily usage...')}</p>}
      {query.isError && (
        <p role='alert'>
          {t('Unable to load daily usage')}{' '}
          <Button variant='outline' onClick={() => void query.refetch()}>
            {t('Retry')}
          </Button>
        </p>
      )}
      {query.data && totals && (
        <>
          <CostSummary totals={totals} />
          <div className='grid gap-3 sm:grid-cols-3' aria-label={t('Call cost summary')}>
            {[
              ["Today's call cost", query.data.today],
              ["This month's call cost", query.data.this_month],
              ['Selected period call cost', totals],
            ].map(([label, value]) => {
              const amount = value as UsageTotals | undefined
              return (
                <Card key={String(label)}>
                  <CardHeader><CardTitle className='text-sm'>{t(String(label))}</CardTitle></CardHeader>
                  <CardContent>
                    <strong className='text-2xl'>{amount ? reportSubtotal(amount) : '—'}</strong>
                    <p className='admin-help'>{t('Beijing time')} · {formatNumber(amount?.requests)} {t('Client requests')}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <div className='daily-kpis'>
            {[
              ['Client requests', totals.requests],
              ['Known input tokens', totals.input_tokens],
              ['Known output tokens', totals.output_tokens],
              ['Requests without usage', totals.unknown_usage],
            ].map(([label, value]) => (
              <div key={label} className='daily-kpi'>
                <span>{t(String(label))}</span>
                <strong>{formatNumber(Number(value))}</strong>
                <small>
                  {t('Selected period')} ·{' '}
                  {view === 'month'
                    ? t('Last 12 months')
                    : `${days} ${t('days')}`}
                </small>
              </div>
            ))}
          </div>
          <p className='admin-help'>
            {t('Today')}: {reportSubtotal(query.data.today)} ·{' '}
            {formatNumber(query.data.today.requests)} {t('Client requests')} ·{' '}
            {formatNumber(query.data.today.total_tokens)}{' '}
            {t('Known total tokens')} ·{' '}
            {formatNumber(query.data.today.unknown_usage)}{' '}
            {t('Requests without usage')} ·{' '}
            {formatNumber(
              query.data.today.report_unpriced_requests ??
              query.data.today.unknown_cost_requests ??
                query.data.today.unpriced_requests
            )}{' '}
            {t('Unpriced requests')}
          </p>
          {query.data.this_month && (
            <p className='admin-help'>
              {t('This month')}: {reportSubtotal(query.data.this_month)} ·{' '}
              {formatNumber(query.data.this_month.requests)}{' '}
              {t('Client requests')} ·{' '}
              {formatNumber(query.data.this_month.total_tokens)}{' '}
              {t('Known total tokens')} ·{' '}
              {formatNumber(query.data.this_month.unknown_usage)}{' '}
              {t('Requests without usage')} ·{' '}
              {formatNumber(
                query.data.this_month.report_unpriced_requests ??
                  query.data.this_month.unknown_cost_requests ??
                  query.data.this_month.unpriced_requests
              )}{' '}
              {t('Unpriced requests')}
            </p>
          )}
          {totals.requests === 0 && (
            <p role='status' className='clear-empty'>
              {t(
                'No client model requests in this period. Usage will appear after a real client request.'
              )}
            </p>
          )}
          <div className='usage-dashboard-grid'>
            <Card>
              <CardHeader>
                <CardTitle>{t('Cost estimate by period')}</CardTitle>
                <p className='admin-help'>
                  {t(
                    'Admission price snapshots and labelled historical current-rate estimates; this is not a supplier bill or balance deduction.'
                  )}
                </p>
              </CardHeader>
              <CardContent>
                <div
                  className='daily-chart-frame'
                  aria-label={t('Cost estimate by period')}
                >
                  <ResponsiveContainer width='100%' height='100%' minWidth={0}>
                    <BarChart data={amounts} accessibilityLayer>
                      <CartesianGrid vertical={false} stroke='#e7edf5' />
                      <XAxis
                        dataKey='date'
                        tickFormatter={(value) =>
                          view === 'month'
                            ? String(value)
                            : String(value).slice(5)
                        }
                        tick={{ fontSize: 12, fill: '#536783' }}
                      />
                      <YAxis
                        allowDecimals={false}
                        width={105}
                        tickFormatter={(value) =>
                          formatCostMicros(Number(value))
                        }
                        tick={{ fontSize: 12, fill: '#536783' }}
                      />
                      <Tooltip
                        formatter={(value) => formatCostMicros(Number(value))}
                        contentStyle={{
                          color: '#18263c',
                          background: '#fff',
                          borderColor: '#ccd7e6',
                        }}
                      />
                      <Legend />
                      <Bar
                        dataKey='snapshot'
                        name={t('Admission price snapshot')}
                        stackId='amount'
                        fill={chartColors[0]}
                        maxBarSize={36}
                      />
                      <Bar
                        dataKey='historical'
                        name={t('Historical current-rate estimate')}
                        stackId='amount'
                        fill={chartColors[1]}
                        maxBarSize={36}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('Aggregate amount by period')}</CardTitle>
                <p className='admin-help'>
                  {t(
                    'Each period adds only known snapshots and labelled historical estimates; unpriced requests stay separate.'
                  )}
                </p>
              </CardHeader>
              <CardContent>
                <StaticDataTable
                  data={amounts}
                  getRowKey={(row) => row.date}
                  columns={[
                    {
                      id: 'period',
                      header: t('Period'),
                      cell: (row) => row.date,
                    },
                    {
                      id: 'calls',
                      header: t('Client requests'),
                      cell: (row) => formatNumber(row.requests),
                    },
                    {
                      id: 'input',
                      header: t('Known input tokens'),
                      cell: (row) => formatNumber(row.input_tokens),
                    },
                    {
                      id: 'output',
                      header: t('Known output tokens'),
                      cell: (row) => formatNumber(row.output_tokens),
                    },
                    {
                      id: 'snapshot',
                      header: t('Admission price snapshot'),
                      cell: (row) => formatCostMicros(row.snapshot),
                    },
                    {
                      id: 'historical',
                      header: t('Historical current-rate estimate'),
                      cell: (row) => formatCostMicros(row.historical),
                    },
                    {
                      id: 'report',
                      header: t('Report estimate'),
                      cell: (row) => row.requests > 0 && row.unpriced === row.requests ? '—' : formatCostMicros(row.report),
                    },
                    {
                      id: 'unpriced',
                      header: t('Unpriced requests'),
                      cell: (row) => formatNumber(row.unpriced),
                    },
                  ]}
                  emptyContent={t('No usage records yet')}
                />
              </CardContent>
            </Card>
          </div>
          <div className='usage-dashboard-grid'>
            <Card>
              <CardHeader>
                <CardTitle>
                  {t(view === 'month' ? 'Monthly token usage' : 'Daily token usage')}
                </CardTitle>
                <p className='admin-help'>
                  {t(
                    'Stacked by the actual upstream model recorded at request time.'
                  )}
                </p>
              </CardHeader>
              <CardContent>
                <div
                  className='daily-chart-frame'
                  aria-label={t(
                    view === 'month' ? 'Monthly token usage' : 'Daily token usage'
                  )}
                >
                  <ResponsiveContainer width='100%' height='100%' minWidth={0}>
                    <BarChart data={chart.data} accessibilityLayer>
                      <CartesianGrid vertical={false} stroke='#e7edf5' />
                      <XAxis
                        dataKey='date'
                        tickFormatter={(value) => String(value).slice(5)}
                        tick={{ fontSize: 12, fill: '#536783' }}
                      />
                      <YAxis
                        allowDecimals={false}
                        width={65}
                        tick={{ fontSize: 12, fill: '#536783' }}
                      />
                      <Tooltip
                        contentStyle={{
                          color: '#18263c',
                          background: '#fff',
                          borderColor: '#ccd7e6',
                        }}
                      />
                      <Legend />
                      {chart.names.map((name, index) => (
                        <Bar
                          key={name}
                          name={name || t('Unknown model')}
                          dataKey={chart.keys.get(name) || name}
                          stackId='tokens'
                          fill={chartColors[index % chartColors.length]}
                          maxBarSize={36}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className='admin-help'>
                  {t(
                    'Only actual client model requests appear here. Model connection tests are not included.'
                  )}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('Model distribution')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className='model-ranking'>
                  {chart.ranks.map((rank, index) => (
                    <div className='ranking-row' key={rank.name}>
                      <div>
                        <b>{rank.name || t('Unknown model')}</b>
                        <strong>{formatNumber(rank.tokens)}</strong>
                      </div>
                      <div className='ranking-track'>
                        <span
                          style={{
                            width: `${totals.total_tokens ? (rank.tokens / totals.total_tokens) * 100 : 0}%`,
                            background: chartColors[index % chartColors.length],
                          }}
                        />
                      </div>
                      <small>
                        {formatNumber(rank.requests)} {t('Client requests')} ·{' '}
                        {formatNumber(rank.unknown)}{' '}
                        {t('Requests without usage')}
                      </small>
                    </div>
                  ))}
                </div>
                <p className='admin-help'>
                  {t('Known total tokens')}: {formatNumber(totals.total_tokens)}
                </p>
                <p className='admin-help'>
                  {t(
                    'Historical model and API names remain as recorded. Unknown values are not reconstructed.'
                  )}
                </p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                {t(view === 'month' ? 'Monthly usage details' : 'Daily usage details')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StaticDataTable
                data={query.data.items.filter((row) => row.requests > 0)}
                getRowKey={(row) =>
                  JSON.stringify([
                    row.date,
                    row.model,
                    row.channel_id,
                    row.channel_name,
                    row.upstream_model,
                  ])
                }
                columns={[
                  { id: 'date', header: t(view === 'month' ? 'Month' : 'Date'), cell: (row) => row.date },
                  {
                    id: 'model',
                    header: t('Upstream model ID'),
                    cell: (row) => (
                      <div>
                        {historicalModel(row) || t('Unknown model')}
                        <small className='block'>
                          {row.model || t('Unknown selection')}
                        </small>
                      </div>
                    ),
                  },
                  {
                    id: 'api',
                    header: t('API connection'),
                    cell: (row) => (
                      <div>
                        {row.channel_name || t('Unknown API')}
                        <small className='block'>
                          {row.channel_id ? `#${row.channel_id}` : '—'}
                        </small>
                      </div>
                    ),
                  },
                  {
                    id: 'calls',
                    header: t('Client requests'),
                    cell: (row) => formatNumber(row.requests),
                  },
                  {
                    id: 'input',
                    header: t('Known input tokens'),
                    cell: (row) => formatNumber(row.input_tokens),
                  },
                  {
                    id: 'output',
                    header: t('Known output tokens'),
                    cell: (row) => formatNumber(row.output_tokens),
                  },
                  {
                    id: 'total',
                    header: t('Known total tokens'),
                    cell: (row) => formatNumber(row.total_tokens),
                  },
                  {
                    id: 'estimated_cny',
                    header: t('Estimated cost (CNY)'),
                    cell: (row) => <CostCell totals={row} />,
                  },
                  {
                    id: 'unknown',
                    header: t('Requests without usage'),
                    cell: (row) => formatNumber(row.unknown_usage),
                  },
                ]}
                emptyContent={t('No usage records yet')}
              />
            </CardContent>
          </Card>
        </>
      )}
      <div className='flex flex-wrap gap-3'>
        <Button onClick={props.onManageAccounts}>{t('Manage accounts')}</Button>
        <Button variant='outline' onClick={props.onViewUsage}>
          {t('View usage')}
        </Button>
      </div>
    </section>
  )
}
export function AccountUsageSummary(props: {
  userId?: number
  onViewUser: (userId: number) => void
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useUsageSummary(page, props.userId)
  let emptyMessage = 'No usage records yet'
  if (query.isPending) emptyMessage = 'Loading...'
  else if (query.isError) emptyMessage = 'Unable to load usage summary'
  return (
    <section className='space-y-4' aria-label={t('Usage by account')}>
      {query.data && <TotalsCards totals={query.data.totals} />}
      <Card className='border border-blue-100 bg-white'>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle>{t('Usage by account')}</CardTitle>
          <Button
            variant='outline'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('Refresh')}
          </Button>
        </CardHeader>
        <CardContent className='space-y-4'>
          <p className='text-sm text-slate-500'>
            {t(
              'All usage figures cover the full retained history. Missing token usage is counted separately and is never estimated.'
            )}
          </p>
          <p className='text-sm text-slate-500'>
            {t(
              'Only actual client model requests appear here. Model connection tests are not included.'
            )}
          </p>
          {query.isError && (
            <p role='alert'>{t('Unable to load usage summary')}</p>
          )}
          <StaticDataTable
            data={query.data?.items || []}
            getRowKey={(row) => row.user_id}
            columns={[
              {
                id: 'account',
                header: t('Account'),
                cell: (row) => `${row.display_name} · ${row.user_id}`,
              },
              {
                id: 'requests',
                header: t('Total requests'),
                cell: (row) => formatNumber(row.requests),
              },
              {
                id: 'successes',
                header: t('Successful requests'),
                cell: (row) => formatNumber(row.successes),
              },
              {
                id: 'failed',
                header: t('Failed requests'),
                cell: (row) => formatNumber(row.failed),
              },
              {
                id: 'uncertain',
                header: t('Uncertain requests'),
                cell: (row) => formatNumber(row.uncertain),
              },
              {
                id: 'input',
                header: t('Known input tokens'),
                cell: (row) => formatNumber(row.input_tokens),
              },
              {
                id: 'output',
                header: t('Known output tokens'),
                cell: (row) => formatNumber(row.output_tokens),
              },
              {
                id: 'total',
                header: t('Known total tokens'),
                cell: (row) => formatNumber(row.total_tokens),
              },
              {
                id: 'estimated_cny',
                header: t('Estimated cost (CNY)'),
                cell: (row) => <CostCell totals={row} />,
              },
              {
                id: 'unknown',
                header: t('Requests without usage'),
                cell: (row) => formatNumber(row.unknown_usage),
              },
              {
                id: 'last',
                header: t('Last used'),
                cell: (row) => formatTimestamp(row.last_used_at),
              },
              {
                id: 'details',
                header: t('Actions'),
                cell: (row) => (
                  <Button
                    variant='outline'
                    onClick={() => props.onViewUser(row.user_id)}
                  >
                    {t('View account usage')}
                  </Button>
                ),
              },
            ]}
            emptyContent={t(emptyMessage)}
          />
          <nav
            aria-label={t('Account usage pagination')}
            className='flex items-center justify-end gap-3'
          >
            <Button
              variant='outline'
              disabled={page === 1 || query.isFetching}
              onClick={() => setPage(page - 1)}
            >
              {t('Previous')}
            </Button>
            <span>
              {formatNumber(page)} · {t('Total records')}:{' '}
              {formatNumber(query.data?.total)}
            </span>
            <Button
              variant='outline'
              disabled={
                query.isFetching || page * 20 >= (query.data?.total || 0)
              }
              onClick={() => setPage(page + 1)}
            >
              {t('Next')}
            </Button>
          </nav>
        </CardContent>
      </Card>
    </section>
  )
}
