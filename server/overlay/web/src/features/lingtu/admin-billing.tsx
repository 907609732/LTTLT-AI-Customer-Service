import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { api } from '@/lib/api'

interface Plan {
  id: string
  name: string
  currency: 'cny'
  amount: number
  calls: number
  valid_days: number
}
type DraftPlan = { [K in keyof Omit<Plan, 'currency'>]: string } & {
  rowKey: string
}
interface Configuration {
  revision: number
  enabled: boolean
  ready: boolean
  reason: string
  source: string
  mode: string
  secret_key_configured: boolean
  webhook_secret_configured: boolean
  plans: Plan[]
  service: { version: string; billing_protocol: number }
  webhook_path: string
}
function draft(plan: Plan): DraftPlan {
  return {
    rowKey: crypto.randomUUID(),
    id: plan.id,
    name: plan.name,
    amount: String(plan.amount),
    calls: String(plan.calls),
    valid_days: String(plan.valid_days),
  }
}
function parsePlans(plans: DraftPlan[]): Plan[] | null {
  const seen = new Set<string>()
  const result: Plan[] = []
  if (plans.length > 20) return null
  for (const plan of plans) {
    const id = plan.id.trim(),
      name = plan.name.trim(),
      amount = Number(plan.amount),
      calls = Number(plan.calls),
      valid_days = Number(plan.valid_days)
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
      seen.has(id) ||
      !name ||
      new TextEncoder().encode(name).byteLength > 128 ||
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 100000000 ||
      !Number.isSafeInteger(calls) ||
      calls < 1 ||
      calls > 1000000 ||
      !Number.isSafeInteger(valid_days) ||
      valid_days < 1 ||
      valid_days > 365
    ) {
      return null
    }
    seen.add(id)
    result.push({ id, name, currency: 'cny', amount, calls, valid_days })
  }
  return result
}
export function AdminBilling() {
  const { t } = useTranslation(),
    queryClient = useQueryClient(),
    verification = useSecureVerification()
  const dirty = useRef(false),
    flight = useRef(false)
  const [revision, setRevision] = useState(0),
    [enabled, setEnabled] = useState(false),
    [plans, setPlans] = useState<DraftPlan[]>([])
  const [key, setKey] = useState(''),
    [webhook, setWebhook] = useState(''),
    [clearKey, setClearKey] = useState(false),
    [clearWebhook, setClearWebhook] = useState(false)
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const query = useQuery({
    queryKey: ['lingtu', 'billing'],
    queryFn: async () =>
      (await api.get<Configuration>('/api/lingtu/admin/billing')).data,
  })
  function apply(value: Configuration) {
    setRevision(value.revision)
    setEnabled(value.enabled)
    setPlans(value.plans.map(draft))
    setClearKey(false)
    setClearWebhook(false)
    dirty.current = false
  }
  useEffect(() => {
    if (query.data && !dirty.current) apply(query.data)
  }, [query.data])
  function editPlan(
    index: number,
    name: keyof Omit<DraftPlan, 'rowKey'>,
    value: string
  ) {
    dirty.current = true
    setPlans((previous) =>
      previous.map((row, position) =>
        position === index ? { ...row, [name]: value } : row
      )
    )
  }
  async function save() {
    if (flight.current) return
    const parsed = parsePlans(plans)
    if (!parsed) {
      setError(
        'Enter valid integer prices, call allowances and days for every plan.'
      )
      return
    }
    if (key && !/^sk_test_[a-zA-Z0-9_]{1,480}$/.test(key)) {
      setError('Use a Stripe sandbox secret key beginning with sk_test_.')
      return
    }
    flight.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const body = JSON.stringify({
        section: 'billing',
        revision,
        enabled,
        secret_key: key,
        webhook_secret: webhook,
        clear_secret_key: clearKey,
        clear_webhook_secret: clearWebhook,
        plans: parsed,
      })
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(body)
      )
      const request_hash = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0')
      ).join('')
      const proof = await verification.requestVerification({
        scope: 'admin.user.managed_config',
        context: { section: 'billing', request_hash },
        title: t('Verify administrator identity to save changes'),
      })
      if (!proof) return
      const result = await api.post<{
        saved: boolean
        configuration: Configuration
      }>('/api/lingtu/admin/billing', body, {
        headers: {
          'Content-Type': 'application/json',
          'X-Security-Proof': proof.proof_token,
        },
        singleUseAuthorization: true,
      })
      if (!result.data.saved || !result.data.configuration) {
        throw new Error('unconfirmed')
      }
      setKey('')
      setWebhook('')
      apply(result.data.configuration)
      queryClient.setQueryData(['lingtu', 'billing'], result.data.configuration)
      setMessage(
        'Configuration saved. Merchant payment and webhook delivery are not verified.'
      )
    } catch (cause) {
      setError(
        isAxiosError(cause) && cause.response?.status === 409
          ? 'Configuration changed. Reload saved configuration before retrying.'
          : 'Configuration save was not confirmed. Reload before retrying.'
      )
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  async function check() {
    if (flight.current) return
    flight.current = true
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const result = await api.post<{
        merchant: string
        mode: string
        webhook: string
        payment: string
      }>('/api/lingtu/admin/billing/check')
      if (
        result.data.merchant !== 'verified' ||
        result.data.mode !== 'test' ||
        result.data.webhook !== 'not_verified' ||
        result.data.payment !== 'not_tested'
      ) {
        throw new Error('unconfirmed')
      }
      setMessage(
        'Merchant account connection verified. Webhook delivery and payment remain untested.'
      )
    } catch {
      setError(
        'Merchant connection could not be verified. Check the saved sandbox key and service network.'
      )
    } finally {
      flight.current = false
      setBusy(false)
    }
  }
  async function reload() {
    const next = await query.refetch()
    if (next.data && !next.isError) {
      apply(next.data)
      setKey('')
      setWebhook('')
      setMessage('')
      setError('')
    }
  }
  if (query.isPending) {
    return <p role='status'>{t('Loading billing configuration...')}</p>
  }
  if (query.isError) {
    return (
      <div>
        <p role='alert'>{t('Billing configuration could not be loaded.')}</p>
        <Button onClick={() => void query.refetch()}>{t('Retry')}</Button>
      </div>
    )
  }
  const config = query.data
  return (
    <section className='space-y-5'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Merchant test configuration')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <p>
            {t(
              'This editor saves sandbox credentials only. No payment is created by saving or checking.'
            )}
          </p>
          <p>
            {t('Current configuration source')}: {config.source} ·{' '}
            {t('Payment mode')}: {config.mode} · {t('Service version')}:{' '}
            {config.service.version}
          </p>
          <p>
            {t('Webhook callback path')}: <code>{config.webhook_path}</code>
          </p>
          <p className='text-sm text-slate-500'>
            {t(
              'Configure this path on your API origin in Stripe. A saved signing secret does not prove webhook delivery.'
            )}
          </p>
          {message && <p role='status'>{t(message)}</p>}
          {error && <p role='alert'>{t(error)}</p>}
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='billing-test-key'>
                {t('Stripe test secret key')}
              </Label>
              <Input
                id='billing-test-key'
                type='password'
                autoComplete='new-password'
                disabled={busy || clearKey}
                value={key}
                placeholder={t(
                  config.secret_key_configured
                    ? 'Configured. Leave blank to keep.'
                    : 'Paste a key to configure'
                )}
                onChange={(event) => {
                  dirty.current = true
                  setKey(event.target.value)
                }}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='billing-webhook-secret'>
                {t('Webhook signing secret')}
              </Label>
              <Input
                id='billing-webhook-secret'
                type='password'
                autoComplete='new-password'
                disabled={busy || clearWebhook}
                value={webhook}
                placeholder={t(
                  config.webhook_secret_configured
                    ? 'Configured. Leave blank to keep.'
                    : 'Paste a key to configure'
                )}
                onChange={(event) => {
                  dirty.current = true
                  setWebhook(event.target.value)
                }}
              />
            </div>
          </div>
          <label className='flex items-center gap-2'>
            <input
              type='checkbox'
              checked={clearKey}
              disabled={busy}
              onChange={(event) => {
                dirty.current = true
                setClearKey(event.target.checked)
                if (event.target.checked) setKey('')
              }}
            />
            {t('Clear saved API key and disable checkout')}
          </label>
          <label className='flex items-center gap-2'>
            <input
              type='checkbox'
              checked={clearWebhook}
              disabled={busy}
              onChange={(event) => {
                dirty.current = true
                setClearWebhook(event.target.checked)
                if (event.target.checked) setWebhook('')
              }}
            />
            {t('Clear saved webhook secret and disable checkout')}
          </label>
          <label className='flex items-center gap-2'>
            <input
              type='checkbox'
              checked={enabled}
              disabled={busy || clearKey || clearWebhook}
              onChange={(event) => {
                dirty.current = true
                setEnabled(event.target.checked)
              }}
            />
            {t('Enable sandbox checkout')}
          </label>
          <p className='text-sm text-slate-500'>
            {t(
              'Disabling checkout keeps signed settlement of existing orders active while credentials remain configured.'
            )}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('Recharge plans')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <p>
            {t(
              'Prices are integer CNY fen. Enter your own test plan; no prices are preselected.'
            )}
          </p>
          {plans.map((plan, index) => (
            <fieldset
              key={plan.rowKey}
              className='grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3'
            >
              <legend>
                {t('Plan')} {index + 1}
              </legend>
              {(
                [
                  ['id', 'Plan ID'],
                  ['name', 'Plan name'],
                  ['amount', 'Amount (fen)'],
                  ['calls', 'Call allowance'],
                  ['valid_days', 'Validity (days)'],
                ] as const
              ).map(([name, label]) => (
                <div key={name} className='space-y-2'>
                  <Label htmlFor={`billing-plan-${index}-${name}`}>
                    {t(label)}
                  </Label>
                  <Input
                    id={`billing-plan-${index}-${name}`}
                    type={name === 'id' || name === 'name' ? 'text' : 'number'}
                    min={1}
                    step={1}
                    value={plan[name]}
                    disabled={busy}
                    onChange={(event) =>
                      editPlan(index, name, event.target.value)
                    }
                  />
                </div>
              ))}
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => {
                  dirty.current = true
                  setPlans((previous) =>
                    previous.filter((_, position) => position !== index)
                  )
                }}
              >
                {t('Remove plan')}
              </Button>
            </fieldset>
          ))}
          <Button
            variant='outline'
            disabled={busy || plans.length >= 20}
            onClick={() => {
              dirty.current = true
              setPlans((previous) => [
                ...previous,
                {
                  rowKey: crypto.randomUUID(),
                  id: '',
                  name: '',
                  amount: '',
                  calls: '',
                  valid_days: '',
                },
              ])
            }}
          >
            {t('Add plan')}
          </Button>
          <div className='flex flex-wrap gap-3'>
            <Button disabled={busy} onClick={() => void save()}>
              {t('Save test configuration')}
            </Button>
            <Button
              variant='outline'
              disabled={
                busy || !config.secret_key_configured || config.mode !== 'test'
              }
              onClick={() => void check()}
            >
              {t('Check merchant connection')}
            </Button>
            <Button
              variant='outline'
              disabled={busy || query.isFetching}
              onClick={() => void reload()}
            >
              {t('Reload saved configuration')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <SecureVerificationDialog {...verification.dialogProps} />
    </section>
  )
}
