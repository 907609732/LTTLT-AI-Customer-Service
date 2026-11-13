import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import {
  BarChart3,
  Boxes,
  Users,
  ListChecks,
  KeyRound,
  Settings2,
  Menu,
} from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { StaticDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { api } from '@/lib/api'
import {
  formatNumber,
  formatTimestamp,
  formatTimestampForInput,
} from '@/lib/format'

import {
  AdminModels,
  type ModelProvider,
  type ModelConnection,
  type ModelSave,
  type SaveResult,
  type SaveFailure,
} from './admin-models'
import { AccountUsageSummary, AdminOverview } from './admin-usage'

import './admin-light.css'

type Payload = Record<string, unknown> & { section: string }
interface Policy {
  calls: number
  days: number
  default_model: string
  daily_calls: number
  max_tokens: number
  per_account_concurrent: number
  requests_per_minute: number
  global_concurrent: number
}
interface LoginProvider {
  provider: string
  app_id: string
  configured: boolean
  enabled: boolean
  callback: string
}
interface Config {
  policy: Policy
  login_providers: LoginProvider[]
  model_catalog?: ModelProvider[]
  model_connections?: ModelConnection[]
  smtp: {
    server: string
    account: string
    from: string
    configured: boolean
    enabled: boolean
    registration_enabled: boolean
    email_verification: boolean
  }
}
const ModelConnectionsContext = createContext<ModelConnection[]>([])
interface Account {
  native_status?: number
  user_id: number
  display_name: string
  status: string
  model: string
  limit: number
  used: number
  reserved: number
  expires_at: number
}
type Save = (payload: Payload) => Promise<boolean>
function modelName(model: string) {
  if (!model || model.startsWith('managed-')) return 'Unknown model'
  if (model === 'qwen3-vl-plus') return 'Qwen3-VL · Image understanding'
  return model
}
function loginStatus(configured: boolean, enabled: boolean) {
  if (enabled && configured) return 'Enabled'
  return configured ? 'Configured but disabled' : 'Not configured'
}
function recordState(state: string) {
  return (
    (
      {
        reserved: 'Processing',
        pending: 'Processing',
        success: 'Success',
        failed: 'Failed',
        uncertain: 'Needs review',
        failed_or_unconfirmed: 'Failed or unconfirmed',
      } as Record<string, string>
    )[state] || 'Needs review'
  )
}
function auditSection(section: string) {
  return (
    (
      {
        account: 'Account authorization',
        trial: 'Trial allowance',
        reconcile: 'Usage reconciliation',
        wechat: 'WeChat sign-in',
        dingtalk: 'DingTalk sign-in',
        smtp: 'Email settings',
        deepseek: 'DeepSeek settings',
        qwen: 'Qwen settings',
        'qwen-vision': 'Qwen3-VL settings',
      } as Record<string, string>
    )[section] || 'Other settings'
  )
}
function ModelSelect(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  allowDefault?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const connections = useContext(ModelConnectionsContext)
  const managed = connections.filter(
    (row) =>
      !['deepseek-flash', 'qwen-plus', 'qwen3-vl-plus'].includes(row.model_id)
  )
  return (
    <div className='space-y-2'>
      <Label htmlFor={props.id}>{props.label}</Label>
      <select
        id={props.id}
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className='border-input bg-background h-10 w-full rounded-lg border px-3 text-sm'
      >
        {props.allowDefault && (
          <option value=''>{t('Follow default settings')}</option>
        )}
        <option value='deepseek-flash'>{t('DeepSeek')}</option>
        <option value='qwen-plus'>{t('Qwen')}</option>
        <option value='qwen3-vl-plus'>
          {t('Qwen3-VL · Image understanding')}
        </option>
        {managed.map((row) => (
          <option key={row.connection_id} value={row.model_id}>
            {row.upstream_model} · {row.name} ({row.model_id})
          </option>
        ))}
        {props.value &&
          !['deepseek-flash', 'qwen-plus', 'qwen3-vl-plus'].includes(
            props.value
          ) &&
          !managed.some((row) => row.model_id === props.value) && (
            <option value={props.value}>{props.value}</option>
          )}
      </select>
    </div>
  )
}
function Field(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <div className='space-y-2'>
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        disabled={props.disabled}
        type={props.type || 'text'}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.type === 'password' ? 'new-password' : 'off'}
      />
    </div>
  )
}
function Credentials(props: {
  name: string
  kind: string
  configured: boolean
  enabled: boolean
  appId?: string
  callback?: string
  save: Save
  busy: boolean
}) {
  const { t } = useTranslation()
  const [secret, setSecret] = useState('')
  const [appId, setAppId] = useState(props.appId || '')
  const [enabled, setEnabled] = useState(props.enabled)
  const [clear, setClear] = useState(false)
  async function save(clearSecret = false): Promise<void> {
    const ok = await props.save({
      section: props.kind,
      app_id: appId,
      secret: clearSecret ? '' : secret,
      clear_secret: clearSecret,
      enabled: clearSecret ? false : enabled,
    })
    if (ok) {
      setSecret('')
      if (clearSecret) setEnabled(false)
    }
  }
  return (
    <Card className='border border-blue-100 bg-white'>
      <CardHeader>
        <CardTitle>{props.name}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        {props.callback && (
          <>
            <Field
              id={`${props.kind}-id`}
              label={t('Application ID')}
              value={appId}
              onChange={setAppId}
            />
            <div className='space-y-2'>
              <p className='text-sm font-medium'>
                {t(
                  'Callback address (copy to the WeChat or DingTalk platform)'
                )}
              </p>
              <div className='flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-xs'>
                <span className='break-all'>{props.callback}</span>
                <CopyButton value={props.callback} />
              </div>
            </div>
          </>
        )}
        <Field
          id={`${props.kind}-secret`}
          label={t(props.callback ? 'Application secret' : 'Model key')}
          value={secret}
          onChange={setSecret}
          type='password'
          placeholder={t(
            props.configured
              ? 'Configured. Leave blank to keep.'
              : 'Paste a key to configure'
          )}
        />
        <div className='flex items-center justify-between'>
          <Label htmlFor={`${props.kind}-enabled`}>{t('Enabled')}</Label>
          <Switch
            id={`${props.kind}-enabled`}
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>
        <div className='flex gap-2'>
          <Button disabled={props.busy} onClick={() => void save()}>
            {t(props.callback || !enabled ? 'Save' : 'Save and test')}
          </Button>
          <Button
            variant='outline'
            disabled={props.busy || !props.configured}
            onClick={() => setClear(true)}
          >
            {t('Clear credential')}
          </Button>
        </div>
        <ConfirmDialog
          open={clear}
          onOpenChange={setClear}
          title={t('Clear credential')}
          desc={t(
            'This disables the provider until a new credential is saved.'
          )}
          destructive
          handleConfirm={() => {
            setClear(false)
            void save(true)
          }}
        />
      </CardContent>
    </Card>
  )
}
function TrialRules(props: { policy: Policy; save: Save; busy: boolean }) {
  const { t } = useTranslation()
  const [policy, setPolicy] = useState({
    ...props.policy,
    per_account_concurrent: props.policy.per_account_concurrent ?? 1,
    requests_per_minute: props.policy.requests_per_minute ?? 5,
    global_concurrent: props.policy.global_concurrent ?? 4,
  })
  const dirtyFields = useRef(new Set<keyof Policy>())
  useEffect(() => {
    setPolicy((previous) => ({
      ...props.policy,
      per_account_concurrent: props.policy.per_account_concurrent ?? 1,
      requests_per_minute: props.policy.requests_per_minute ?? 5,
      global_concurrent: props.policy.global_concurrent ?? 4,
      ...Object.fromEntries(
        [...dirtyFields.current].map((key) => [key, previous[key]])
      ),
    }))
  }, [props.policy])
  function editPolicy<K extends keyof Policy>(key: K, value: Policy[K]) {
    dirtyFields.current.add(key)
    setPolicy((previous) => ({ ...previous, [key]: value }))
  }
  async function savePolicy(): Promise<void> {
    const ok = await props.save({
      section: 'trial',
      ...policy,
      model: policy.default_model,
    })
    if (ok) dirtyFields.current.clear()
  }
  return (
    <Card className='max-w-2xl border border-blue-100 bg-white'>
      <CardHeader>
        <CardTitle>{t('Trial rules')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <p className='text-sm text-slate-500'>
          {t(
            'Changes apply to newly granted trials. Existing accounts keep their grants.'
          )}
        </p>
        <p className='text-sm text-slate-500'>
          {t(
            'Concurrency and rate limits apply to current requests across the service.'
          )}
        </p>
        {(
          [
            'calls',
            'days',
            'daily_calls',
            'max_tokens',
            'per_account_concurrent',
            'requests_per_minute',
            'global_concurrent',
          ] as const
        ).map((key) => (
          <Field
            key={key}
            id={`trial-${key}`}
            disabled={props.busy}
            label={t(
              {
                calls: 'Trial calls',
                days: 'Trial days',
                daily_calls: 'Daily trial call cap',
                max_tokens: 'Maximum output tokens',
                per_account_concurrent: 'Concurrent requests per account',
                requests_per_minute: 'Requests per minute per account',
                global_concurrent: 'Global concurrent requests',
              }[key]
            )}
            value={String(policy[key])}
            onChange={(value) => editPolicy(key, Number(value))}
            type='number'
          />
        ))}
        <ModelSelect
          id='default-model'
          disabled={props.busy}
          label={t('Default model')}
          value={policy.default_model}
          onChange={(value) => editPolicy('default_model', value)}
        />
        <Button disabled={props.busy} onClick={() => void savePolicy()}>
          {t('Save')}
        </Button>
      </CardContent>
    </Card>
  )
}
function AccountEditor(props: {
  account: Account
  save: Save
  busy: boolean
  close: () => void
}) {
  const nativeDisabled = props.account.native_status === 2
  const { t } = useTranslation()
  const [calls, setCalls] = useState(String(props.account.limit))
  const [expires, setExpires] = useState(
    formatTimestampForInput(props.account.expires_at)
  )
  const [enabled, setEnabled] = useState(props.account.status === 'enabled')
  const [model, setModel] = useState(props.account.model)
  const [reason, setReason] = useState('')
  async function submit(revoke: boolean): Promise<void> {
    if (nativeDisabled) return
    const ok = await props.save({
      section: 'account',
      user_id: props.account.user_id,
      calls: Number(calls),
      expires_at: Math.floor(new Date(expires).getTime() / 1000),
      status: enabled ? 'enabled' : 'disabled',
      model,
      reason,
      revoke,
    })
    if (ok) props.close()
  }
  return (
    <Card className='border border-blue-100 bg-white'>
      <CardHeader>
        <CardTitle>
          {props.account.display_name} · {props.account.user_id}
        </CardTitle>
      </CardHeader>
      <CardContent className='grid gap-4 sm:grid-cols-2'>
        {nativeDisabled && (
          <p role='status' className='text-sm text-amber-700 sm:col-span-2'>
            {t(
              'This account is disabled in the main account system. Enable it there before editing model authorization.'
            )}
          </p>
        )}
        <Field
          id='account-calls'
          disabled={nativeDisabled}
          label={t('Total authorized calls')}
          value={calls}
          onChange={setCalls}
          type='number'
        />
        <Field
          id='account-expiry'
          disabled={nativeDisabled}
          label={t('Expires at')}
          value={expires}
          onChange={setExpires}
          type='datetime-local'
        />
        <ModelSelect
          id='account-model'
          disabled={nativeDisabled}
          label={t('Model for this account')}
          value={model}
          onChange={setModel}
          allowDefault
        />
        <Field
          id='account-reason'
          disabled={nativeDisabled}
          label={t('Reason for change')}
          value={reason}
          onChange={setReason}
        />
        <div className='flex items-center gap-3'>
          <Label htmlFor='account-enabled'>{t('Enabled')}</Label>
          <Switch
            id='account-enabled'
            disabled={nativeDisabled}
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>
        <div className='flex gap-2'>
          <Button
            disabled={props.busy || nativeDisabled || !reason.trim()}
            onClick={() => void submit(false)}
          >
            {t('Save')}
          </Button>
          <Button
            variant='outline'
            disabled={props.busy || nativeDisabled || !reason.trim()}
            onClick={() => void submit(true)}
          >
            {t('Save and revoke sessions')}
          </Button>
          <Button variant='ghost' onClick={props.close}>
            {t('Cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
function Accounts(props: {
  save: Save
  busy: boolean
  onViewUsage: (userId: number) => void
}) {
  const { t } = useTranslation()
  const connections = useContext(ModelConnectionsContext)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Account | null>(null)
  const query = useQuery({
    queryKey: ['lingtu', 'accounts', page],
    queryFn: async () =>
      (
        await api.get<{ items: Account[]; total: number }>(
          '/api/lingtu/admin/accounts',
          {
            params: { page },
          }
        )
      ).data,
  })
  return (
    <div className='space-y-4'>
      {selected && (
        <AccountEditor
          key={selected.user_id}
          account={selected}
          save={props.save}
          busy={props.busy}
          close={() => setSelected(null)}
        />
      )}
      {query.isError && <p role='alert'>{t('Unable to load accounts')}</p>}
      <StaticDataTable
        data={query.data?.items || []}
        getRowKey={(row) => row.user_id}
        columns={[
          {
            id: 'id',
            header: t('Account'),
            cell: (row) => (
              <span>
                {row.display_name} · {row.user_id}
              </span>
            ),
          },
          {
            id: 'model',
            header: t('Model'),
            cell: (row) => {
              const connection = connections.find(
                (item) => item.model_id === row.model
              )
              return (
                <div>
                  {connection
                    ? `${connection.name} · ${connection.upstream_model}`
                    : t(
                        row.model
                          ? modelName(row.model)
                          : 'Follow default settings'
                      )}
                  {row.model.startsWith('managed-') && (
                    <small className='block'>{row.model}</small>
                  )}
                </div>
              )
            },
          },
          {
            id: 'quota',
            header: t('Trial calls'),
            cell: (row) =>
              `${formatNumber(row.used)} / ${formatNumber(row.limit)} (${formatNumber(row.reserved)} ${t('pending')})`,
          },
          {
            id: 'expiry',
            header: t('Expires at'),
            cell: (row) => formatTimestamp(row.expires_at),
          },
          {
            id: 'status',
            header: t('Status'),
            cell: (row) => {
              if (row.native_status === 2) {
                return t('Disabled in the main account system')
              }
              if (row.status === 'enabled') return t('Enabled')
              if (row.status === 'not_authorized') return t('Not authorized')
              return t('Disabled')
            },
          },
          {
            id: 'edit',
            header: t('Actions'),
            cell: (row) => (
              <div className='flex gap-2'>
                <Button variant='outline' onClick={() => setSelected(row)}>
                  {t('Edit')}
                </Button>
                <Button
                  variant='outline'
                  onClick={() => props.onViewUsage(row.user_id)}
                >
                  {t('View account usage')}
                </Button>
              </div>
            ),
          },
        ]}
        emptyContent={t(query.isPending ? 'Loading...' : 'No accounts yet')}
      />
      <div className='flex justify-end gap-3'>
        <Button
          variant='outline'
          disabled={page === 1 || query.isFetching}
          onClick={() => setPage(page - 1)}
        >
          {t('Previous')}
        </Button>
        <span>{formatNumber(page)}</span>
        <Button
          variant='outline'
          disabled={query.isFetching || page * 20 >= (query.data?.total || 0)}
          onClick={() => setPage(page + 1)}
        >
          {t('Next')}
        </Button>
      </div>
    </div>
  )
}
interface UsageRecord {
  user_id: number
  display_name: string
  request_id: string
  state: string
  created_at: number
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  usage_known: boolean
  diagnostic: string
}
interface AuditRecord {
  id: number
  actor_id: number
  target_id: number
  section: string
  outcome: string
  reason: string
  created_at: number
}
interface Page<T> {
  items: T[]
  total: number
  page: number
}
function RecordPages(props: {
  page: number
  total: number
  fetching: boolean
  setPage: (page: number) => void
}) {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('Record pagination')}
      className='flex items-center justify-end gap-3'
    >
      <Button
        variant='outline'
        disabled={props.page === 1 || props.fetching}
        onClick={() => props.setPage(props.page - 1)}
      >
        {t('Previous')}
      </Button>
      <span className='text-sm'>
        {formatNumber(props.page)} · {t('Total records')}:{' '}
        {formatNumber(props.total)}
      </span>
      <Button
        variant='outline'
        disabled={props.fetching || props.page * 20 >= props.total}
        onClick={() => props.setPage(props.page + 1)}
      >
        {t('Next')}
      </Button>
    </nav>
  )
}
function UsageRecords(props: { save: Save; busy: boolean; userId?: number }) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<{
    row: UsageRecord
    outcome: 'success' | 'failed'
  } | null>(null)
  const [reason, setReason] = useState('')
  const reconciling = useRef(false)
  const query = useQuery({
    queryKey: ['lingtu', 'usage', page, props.userId ?? null],
    queryFn: async () =>
      (
        await api.get<Page<UsageRecord>>('/api/lingtu/admin/usage', {
          params: { page, ...(props.userId ? { user_id: props.userId } : {}) },
        })
      ).data,
  })
  let emptyMessage = 'No usage records yet'
  if (query.isPending) emptyMessage = 'Loading...'
  else if (query.isError) emptyMessage = 'Unable to load usage records'
  async function reconcile(): Promise<void> {
    if (!selected || !reason.trim() || props.busy || reconciling.current) return
    reconciling.current = true
    try {
      const ok = await props.save({
        section: 'reconcile',
        user_id: selected.row.user_id,
        request_id: selected.row.request_id,
        outcome: selected.outcome,
        reason: reason.trim(),
      })
      if (ok) {
        setSelected(null)
        setReason('')
      }
    } finally {
      reconciling.current = false
    }
  }
  return (
    <Card className='border border-blue-100 bg-white'>
      <CardHeader className='flex flex-row items-center justify-between'>
        <CardTitle>{t('Usage records')}</CardTitle>
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
            'Uncertain results require verification before reconciliation. This only updates accounting and never resends a model request.'
          )}
        </p>
        {query.isError && (
          <p role='alert'>{t('Unable to load usage records')}</p>
        )}
        <StaticDataTable
          data={query.data?.items || []}
          getRowKey={(row) => `${row.user_id}:${row.request_id}`}
          columns={[
            {
              id: 'account',
              header: t('Account'),
              cell: (row) => `${row.display_name || ''} · ${row.user_id}`,
            },
            {
              id: 'request',
              header: t('Request ID'),
              cell: (row) => (
                <span className='font-mono text-xs break-all'>
                  {row.request_id}
                </span>
              ),
            },
            {
              id: 'time',
              header: t('Time'),
              cell: (row) => formatTimestamp(row.created_at),
            },
            {
              id: 'model',
              header: t('Model'),
              cell: (row) => (
                <div>
                  {t(modelName(row.model))}
                  {row.model.startsWith('managed-') && (
                    <small className='block'>{row.model}</small>
                  )}
                </div>
              ),
            },
            {
              id: 'state',
              header: t('Status'),
              cell: (row) => t(recordState(row.state)),
            },
            {
              id: 'tokens',
              header: t('Input / output tokens'),
              cell: (row) =>
                row.usage_known === true
                  ? `${formatNumber(row.input_tokens)} / ${formatNumber(row.output_tokens)}`
                  : t('Usage not returned'),
            },
            {
              id: 'totalTokens',
              header: t('Returned token total'),
              cell: (row) =>
                row.usage_known === true
                  ? formatNumber(row.total_tokens)
                  : t('Usage not returned'),
            },
            {
              id: 'diagnostic',
              header: t('Action guidance'),
              cell: (row) =>
                row.state === 'uncertain'
                  ? t('Verify the actual result before reconciliation')
                  : '—',
            },
            {
              id: 'actions',
              header: t('Actions'),
              cell: (row) =>
                row.state === 'uncertain' ? (
                  <div className='flex gap-2'>
                    <Button
                      variant='outline'
                      disabled={props.busy}
                      onClick={() => {
                        setReason('')
                        setSelected({ row, outcome: 'success' })
                      }}
                    >
                      {t('Confirm success')}
                    </Button>
                    <Button
                      variant='outline'
                      disabled={props.busy}
                      onClick={() => {
                        setReason('')
                        setSelected({ row, outcome: 'failed' })
                      }}
                    >
                      {t('Confirm failure')}
                    </Button>
                  </div>
                ) : (
                  '—'
                ),
            },
          ]}
          emptyContent={t(emptyMessage)}
        />
        <RecordPages
          page={page}
          total={query.data?.total || 0}
          fetching={query.isFetching}
          setPage={setPage}
        />
        <ConfirmDialog
          open={!!selected}
          onOpenChange={(open) => {
            if (!open && !props.busy) setSelected(null)
          }}
          title={t(
            selected?.outcome === 'success'
              ? 'Confirm successful result'
              : 'Confirm failed result'
          )}
          desc={
            <div className='space-y-3'>
              <p>
                {t(
                  'Verify the actual upstream result. Successful results consume one call; failed results release the reserved call. No request is resent.'
                )}
              </p>
              <p className='font-mono text-xs break-all'>
                {selected?.row.user_id} · {selected?.row.request_id}
              </p>
              <Field
                id='reconcile-reason'
                label={t('Reason for change')}
                value={reason}
                onChange={setReason}
              />
            </div>
          }
          confirmText={t('Confirm reconciliation')}
          disabled={!reason.trim() || reason.trim().length > 256 || props.busy}
          isLoading={props.busy}
          handleConfirm={() => void reconcile()}
        />
      </CardContent>
    </Card>
  )
}
function AuditRecords() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['lingtu', 'audit', page],
    queryFn: async () =>
      (
        await api.get<Page<AuditRecord>>('/api/lingtu/admin/audit', {
          params: { page },
        })
      ).data,
  })
  let emptyMessage = 'No audit records yet'
  if (query.isPending) emptyMessage = 'Loading...'
  else if (query.isError) emptyMessage = 'Unable to load audit records'
  return (
    <Card className='border border-blue-100 bg-white'>
      <CardHeader className='flex flex-row items-center justify-between'>
        <CardTitle>{t('Administrative audit')}</CardTitle>
        <Button
          variant='outline'
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </CardHeader>
      <CardContent className='space-y-4'>
        {query.isError && (
          <p role='alert'>{t('Unable to load audit records')}</p>
        )}
        <StaticDataTable
          data={query.data?.items || []}
          getRowKey={(row) => row.id}
          columns={[
            {
              id: 'time',
              header: t('Time'),
              cell: (row) => formatTimestamp(row.created_at),
            },
            {
              id: 'actor',
              header: t('Administrator ID'),
              cell: (row) => formatNumber(row.actor_id),
            },
            {
              id: 'target',
              header: t('Target account'),
              cell: (row) =>
                row.target_id ? formatNumber(row.target_id) : '—',
            },
            {
              id: 'section',
              header: t('Configuration section'),
              cell: (row) => t(auditSection(row.section)),
            },
            {
              id: 'outcome',
              header: t('Outcome'),
              cell: (row) => t(recordState(row.outcome)),
            },
            {
              id: 'reason',
              header: t('Reason for change'),
              cell: (row) => (
                <span className='break-all'>{row.reason || '—'}</span>
              ),
            },
          ]}
          emptyContent={t(emptyMessage)}
        />
        <RecordPages
          page={page}
          total={query.data?.total || 0}
          fetching={query.isFetching}
          setPage={setPage}
        />
      </CardContent>
    </Card>
  )
}
function MailSettings(props: {
  config: Config['smtp']
  save: Save
  busy: boolean
}) {
  const { t } = useTranslation()
  const [server, setServer] = useState(props.config.server || '')
  const [account, setAccount] = useState(props.config.account || '')
  const [from, setFrom] = useState(props.config.from || '')
  const [secret, setSecret] = useState('')
  return (
    <Card className='border border-blue-100 bg-white'>
      <CardHeader>
        <CardTitle>{t('Email fallback')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <p className='text-sm text-slate-500'>
          {t(
            'SMTP uses encrypted TLS on port 465. Verify actual email delivery before opening registration.'
          )}
        </p>
        <Field
          id='smtp-server'
          label={t('Email server')}
          value={server}
          onChange={setServer}
        />
        <Field
          id='smtp-account'
          label={t('Email account')}
          value={account}
          onChange={setAccount}
        />
        <Field
          id='smtp-from'
          label={t('Sender email')}
          value={from}
          onChange={setFrom}
        />
        <Field
          id='smtp-secret'
          label={t('Email authorization code')}
          value={secret}
          onChange={setSecret}
          type='password'
          placeholder={t(
            props.config.configured
              ? 'Configured. Leave blank to keep.'
              : 'Paste a key to configure'
          )}
        />
        <Button
          disabled={props.busy}
          onClick={() =>
            void props
              .save({
                section: 'smtp',
                smtp_server: server,
                smtp_account: account,
                smtp_from: from,
                secret,
              })
              .then((ok) => {
                if (ok) setSecret('')
              })
          }
        >
          {t('Save')}
        </Button>
      </CardContent>
    </Card>
  )
}

const adminLanguagePreference = 'lingtu-admin-language'
function readAdminLanguage(): 'zhCN' | 'en' {
  try {
    if (localStorage.getItem(adminLanguagePreference) === 'en') return 'en'
  } catch {
    /* Browser storage can be unavailable. */
  }
  return 'zhCN'
}
function UsageFilter(props: {
  userId?: number
  onChange: (userId: number | undefined) => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(props.userId ? String(props.userId) : '')
  const valid =
    value === '' ||
    (/^\d+$/.test(value) &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) > 0)
  return (
    <form
      className='flex flex-wrap items-end gap-3 rounded-xl border border-blue-100 bg-white p-4'
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) props.onChange(value ? Number(value) : undefined)
      }}
    >
      <div className='space-y-2'>
        <Label htmlFor='usage-user-filter'>{t('Filter by account ID')}</Label>
        <Input
          id='usage-user-filter'
          inputMode='numeric'
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('Leave blank for all accounts')}
        />
      </div>
      <Button type='submit' disabled={!valid}>
        {t('Apply filter')}
      </Button>
      <Button
        type='button'
        variant='outline'
        onClick={() => {
          setValue('')
          props.onChange(undefined)
        }}
      >
        {t('All accounts')}
      </Button>
      {props.userId && (
        <p role='status' className='text-sm text-slate-600'>
          {t('Account ID')}: {props.userId}
        </p>
      )}
      {!valid && (
        <p role='alert' className='text-sm text-red-600'>
          {t('Enter a positive account ID')}
        </p>
      )}
    </form>
  )
}
export function AdminPage() {
  const { t, i18n } = useTranslation()
  const [language, setLanguage] = useState(readAdminLanguage)
  useEffect(() => {
    void i18n.changeLanguage(language)
    document.documentElement.lang = language === 'zhCN' ? 'zh-CN' : 'en'
    try {
      localStorage.setItem(adminLanguagePreference, language)
    } catch {
      /* Keep the chosen language in memory. */
    }
  }, [i18n, language])
  const queryClient = useQueryClient()
  const verification = useSecureVerification()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const saving = useRef(false)
  const [tab, setTab] = useState('overview')
  const [usageUserId, setUsageUserId] = useState<number | undefined>()
  const [mobileNav, setMobileNav] = useState(false)
  const [visitedTabs, setVisitedTabs] = useState(
    () => new Set(['overview', 'models'])
  )
  const selectTab = (next: string) => {
    setTab(next)
    setMobileNav(false)
    setVisitedTabs((previous) =>
      previous.has(next) ? previous : new Set([...previous, next])
    )
  }
  const query = useQuery({
    queryKey: ['lingtu', 'config'],
    queryFn: async () =>
      (await api.get<Config>('/api/lingtu/admin/config')).data,
  })
  const viewUserUsage = (userId: number) => {
    setUsageUserId(userId)
    selectTab('usage')
  }
  async function save(
    payload: Payload
  ): Promise<SaveResult | SaveFailure | false> {
    if (saving.current) return false
    saving.current = true
    setBusy(true)
    setMessage('')
    let submitted = false
    function apply(result: SaveResult) {
      const connections = result.model_connections
      if (connections) {
        queryClient.setQueryData<Config>(['lingtu', 'config'], (previous) =>
          previous ? { ...previous, model_connections: connections } : previous
        )
      }
    }
    try {
      const body = JSON.stringify(payload)
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(body)
      )
      const hash = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0')
      ).join('')
      const proof = await verification.requestVerification({
        scope: 'admin.user.managed_config',
        context: { section: payload.section, request_hash: hash },
        title: t('Verify administrator identity to save changes'),
      })
      if (!proof) return false
      submitted = true
      const result = await api.post<SaveResult>(
        '/api/lingtu/admin/config',
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Security-Proof': proof.proof_token,
          },
          singleUseAuthorization: true,
        }
      )
      if (!result.data.saved) throw new Error('Save failed')
      apply(result.data)
      await queryClient.invalidateQueries({ queryKey: ['lingtu'] })
      let message = 'Saved successfully.'
      if (payload.section === 'model_connection') {
        message = result.data.tested
          ? 'Configuration saved and connection tested. The default API is unchanged.'
          : 'Configuration saved. Review the connection status before using it.'
      }
      setMessage(message)
      return result.data
    } catch (error) {
      const data = isAxiosError(error) ? error.response?.data : undefined
      if (
        payload.section === 'model_connection' &&
        data?.saved === true &&
        data?.tested === false &&
        data?.connection_id > 0 &&
        Array.isArray(data.model_connections)
      ) {
        const result = data as SaveResult
        apply(result)
        await queryClient.invalidateQueries({ queryKey: ['lingtu'] })
        setMessage(
          'Configuration saved, but the connection test failed. Review the settings and test again.'
        )
        return result
      }
      await queryClient.invalidateQueries({ queryKey: ['lingtu'] })
      setMessage(
        'Save could not be confirmed. Refresh configuration and review before retrying.'
      )
      return {
        saved: false,
        unconfirmed:
          submitted &&
          (!isAxiosError(error) ||
            !error.response ||
            error.response.status >= 500),
      }
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  const legacySave: Save = async (payload) => {
    const result = await save(payload)
    return !!result && result.saved
  }
  const modelSave: ModelSave = save
  const languageControl = (
    <div
      role='group'
      aria-label={t('Interface language')}
      className='flex gap-1'
    >
      <Button
        variant={language === 'zhCN' ? 'default' : 'outline'}
        aria-pressed={language === 'zhCN'}
        onClick={() => setLanguage('zhCN')}
      >
        中文
      </Button>
      <Button
        variant={language === 'en' ? 'default' : 'outline'}
        aria-pressed={language === 'en'}
        onClick={() => setLanguage('en')}
      >
        English
      </Button>
    </div>
  )
  if (query.isPending) {
    return (
      <div className='lingtu-admin-light space-y-4 bg-blue-50 p-8'>
        {languageControl}
        <p role='status'>{t('Loading configuration...')}</p>
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className='lingtu-admin-light space-y-4 bg-blue-50 p-8'>
        {languageControl}
        <p role='alert'>
          {t('Unable to load configuration. Refresh the page to try again.')}
        </p>
        <Button onClick={() => void query.refetch()}>{t('Retry')}</Button>
      </div>
    )
  }
  const config = query.data
  const sections = [
    ['overview', 'Overview', BarChart3],
    ['models', 'Model configuration', Boxes],
    ['accounts', 'Account management', Users],
    ['usage', 'Usage records', ListChecks],
    ['login', 'Sign-in methods', KeyRound],
    ['trial', 'Trial settings', Settings2],
  ] as const
  return (
    <main className='lingtu-admin-light lingtu-admin-shell'>
      <ModelConnectionsContext.Provider value={config.model_connections || []}>
        <TabsPrimitive.Root
          value={tab}
          orientation='vertical'
          onValueChange={(value) => selectTab(String(value))}
          className='admin-layout group/tabs'
        >
          <aside className={`admin-sidebar ${mobileNav ? 'nav-open' : ''}`}>
            <div className='admin-brand'>
              <span className='admin-logo'>灵</span>
              <div>
                <b>{t('Lingtu customer service')}</b>
                <small>{t('Administration')}</small>
              </div>
              <Button
                className='mobile-menu'
                variant='ghost'
                aria-label={t('Open navigation')}
                aria-expanded={mobileNav}
                onClick={() => setMobileNav(!mobileNav)}
              >
                <Menu />
              </Button>
            </div>
            <TabsList
              aria-label={t('Administration sections')}
              className='admin-navigation'
            >
              {sections.map(([id, label, Icon]) => (
                <TabsTrigger key={id} value={id}>
                  <Icon aria-hidden='true' />
                  {t(label)}
                </TabsTrigger>
              ))}
            </TabsList>
            <p className='admin-sidebar-note'>
              {t('Your model keys remain on the server.')}
            </p>
          </aside>
          <div className='admin-main'>
            <header className='admin-topbar'>
              <div>
                <p role='heading' aria-level={2}>
                  {t('Lingtu customer service administration')}
                </p>
                <h1>
                  {t(sections.find(([id]) => id === tab)?.[1] || 'Overview')}
                </h1>
              </div>
              <div className='admin-tools'>
                {languageControl}
                <Button
                  variant='outline'
                  disabled={query.isFetching}
                  onClick={() =>
                    void queryClient.invalidateQueries({ queryKey: ['lingtu'] })
                  }
                >
                  {t('Refresh')}
                </Button>
              </div>
            </header>
            <div className='admin-workspace'>
              {message && (
                <p role='status' className='admin-message'>
                  {t(message)}
                </p>
              )}
              <TabsContent value='overview'>
                <AdminOverview
                  onManageAccounts={() => selectTab('accounts')}
                  onViewUsage={() => selectTab('usage')}
                />
              </TabsContent>
              <TabsContent value='models' keepMounted>
                <AdminModels
                  catalog={config.model_catalog || []}
                  connections={config.model_connections || []}
                  save={modelSave}
                  busy={busy}
                />
              </TabsContent>
              <TabsContent value='accounts' keepMounted>
                {visitedTabs.has('accounts') && (
                  <Accounts
                    save={legacySave}
                    busy={busy}
                    onViewUsage={viewUserUsage}
                  />
                )}
              </TabsContent>
              <TabsContent value='usage'>
                <div className='space-y-5'>
                  <UsageFilter
                    key={usageUserId ?? 'all'}
                    userId={usageUserId}
                    onChange={setUsageUserId}
                  />
                  <AccountUsageSummary
                    key={`summary-${usageUserId ?? 'all'}`}
                    userId={usageUserId}
                    onViewUser={viewUserUsage}
                  />
                  <UsageRecords
                    key={`records-${usageUserId ?? 'all'}`}
                    save={legacySave}
                    busy={busy}
                    userId={usageUserId}
                  />
                  <AuditRecords />
                </div>
              </TabsContent>
              <TabsContent value='login' keepMounted>
                {visitedTabs.has('login') && (
                  <>
                    <p className='admin-intro'>
                      {t(
                        'Enable a sign-in method after completing its platform configuration.'
                      )}
                    </p>
                    <div className='login-grid'>
                      <article
                        aria-label={t('Email sign-in')}
                        className='login-card'
                      >
                        <span className='provider-mark'>@</span>
                        <h2>{t('Email sign-in')}</h2>
                        <span className='clear-state'>
                          {t(
                            loginStatus(
                              config.smtp.configured,
                              config.smtp.enabled
                            )
                          )}
                        </span>
                        <p>
                          {t(
                            config.smtp.registration_enabled
                              ? 'Registration enabled'
                              : 'Registration disabled'
                          )}
                        </p>
                        <p>
                          {t(
                            config.smtp.email_verification
                              ? 'Email verification enabled'
                              : 'Email verification disabled'
                          )}
                        </p>
                        <details>
                          <summary>{t('Setup details')}</summary>
                          <MailSettings
                            config={config.smtp}
                            save={legacySave}
                            busy={busy}
                          />
                        </details>
                      </article>
                      {(['wechat', 'dingtalk'] as const).map((kind) => {
                        const provider = config.login_providers.find(
                          (row) => row.provider === kind
                        )
                        return (
                          <article
                            key={kind}
                            aria-label={t(
                              kind === 'wechat' ? 'WeChat' : 'DingTalk'
                            )}
                            className='login-card'
                          >
                            <span className='provider-mark'>
                              {kind === 'wechat' ? 'W' : 'D'}
                            </span>
                            <h2>
                              {t(kind === 'wechat' ? 'WeChat' : 'DingTalk')}
                            </h2>
                            <span
                              className={`clear-state ${provider?.enabled && provider.configured ? 'ready' : 'empty'}`}
                            >
                              {t(
                                loginStatus(
                                  !!provider?.configured,
                                  !!provider?.enabled
                                )
                              )}
                            </span>
                            <p>
                              {t(
                                kind === 'wechat'
                                  ? 'Configure the website application and OAuth callback on the WeChat platform.'
                                  : 'Configure the application credentials and callback on the DingTalk platform.'
                              )}
                            </p>
                            <details>
                              <summary>{t('Setup details')}</summary>
                              {provider ? (
                                <Credentials
                                  name={t(
                                    kind === 'wechat' ? 'WeChat' : 'DingTalk'
                                  )}
                                  kind={kind}
                                  configured={provider.configured}
                                  enabled={provider.enabled}
                                  appId={provider.app_id}
                                  callback={provider.callback}
                                  save={legacySave}
                                  busy={busy}
                                />
                              ) : (
                                <p>
                                  {t(
                                    'Provider configuration is unavailable. Refresh to retry.'
                                  )}
                                </p>
                              )}
                            </details>
                          </article>
                        )
                      })}
                    </div>
                  </>
                )}
              </TabsContent>
              <TabsContent value='trial' keepMounted>
                {visitedTabs.has('trial') && (
                  <TrialRules
                    policy={config.policy}
                    save={legacySave}
                    busy={busy}
                  />
                )}
              </TabsContent>
            </div>
            <footer className='admin-footer'>
              <span>
                {t('Powered by')}{' '}
                <a
                  href='https://github.com/QuantumNous/new-api'
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  New API
                </a>
              </span>
              <a
                href='https://github.com/907609732/LTTLT-AI-Customer-Service'
                target='_blank'
                rel='noopener noreferrer'
              >
                {t('Modified source (AGPL-3.0)')}
              </a>
            </footer>
          </div>
        </TabsPrimitive.Root>
      </ModelConnectionsContext.Provider>
      <SecureVerificationDialog {...verification.dialogProps} />
    </main>
  )
}
