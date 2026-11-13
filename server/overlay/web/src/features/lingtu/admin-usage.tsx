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

interface UsageTotals {
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
    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
      {cards.map(([label, value]) => (
        <Card key={label} className='border border-blue-100 bg-white'>
          <CardHeader>
            <CardTitle className='text-sm text-slate-500'>{t(label)}</CardTitle>
          </CardHeader>
          <CardContent className='text-2xl font-semibold'>
            {formatNumber(value)}
          </CardContent>
        </Card>
      ))}
    </div>
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
  days: 7 | 30
  model: string
  today: UsageTotals
  totals: UsageTotals
  items: DailyUsageItem[]
  model_options: string[]
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
  const [days, setDays] = useState<7 | 30>(7)
  const [model, setModel] = useState('')
  const query = useQuery({
    queryKey: ['lingtu', 'usage-daily', days, model],
    queryFn: async () =>
      (
        await api.get<DailyUsage>('/api/lingtu/admin/usage-daily', {
          params: { days, ...(model ? { model } : {}) },
        })
      ).data,
  })
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
            'Actual client usage by Beijing natural day. Missing usage is counted separately and never estimated.'
          )}
        </p>
        <div className='daily-chart-controls'>
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
                  {t('Selected period')} · {days} {t('days')}
                </small>
              </div>
            ))}
          </div>
          <p className='admin-help'>
            {t('Today')}: {formatNumber(query.data.today.requests)}{' '}
            {t('Client requests')} ·{' '}
            {formatNumber(query.data.today.total_tokens)}{' '}
            {t('Known total tokens')} ·{' '}
            {formatNumber(query.data.today.unknown_usage)}{' '}
            {t('Requests without usage')}
          </p>
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
                <CardTitle>{t('Daily token usage')}</CardTitle>
                <p className='admin-help'>
                  {t(
                    'Stacked by the actual upstream model recorded at request time.'
                  )}
                </p>
              </CardHeader>
              <CardContent>
                <div
                  className='daily-chart-frame'
                  aria-label={t('Daily token usage')}
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
              <CardTitle>{t('Daily usage details')}</CardTitle>
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
                  { id: 'date', header: t('Date'), cell: (row) => row.date },
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
