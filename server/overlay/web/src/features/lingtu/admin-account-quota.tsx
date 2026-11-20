import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatNumber } from '@/lib/format'

export interface Account {
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
type BatchSave = (
  payload: Record<string, unknown> & { section: string }
) => Promise<boolean>
type AdjustmentMode = 'add' | 'subtract' | 'set'
type PreviewRow = {
  account: Account
  target: number | null
  error: string
  remaining: number
}
const maxCalls = 1000000
const maxReasonBytes = 180

function targetFor(
  account: Account,
  mode: AdjustmentMode,
  amount: number
): number {
  if (mode === 'add') return account.limit + amount
  if (mode === 'subtract') return account.limit - amount
  return amount
}

export function AccountBatchQuota(props: {
  accounts: Account[]
  save: BatchSave
  busy: boolean
  onClear: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AdjustmentMode>('add')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const submitting = useRef(false)

  const numericAmount =
    amount.trim() !== '' && Number.isInteger(Number(amount))
      ? Number(amount)
      : null
  const preview = useMemo(() => {
    return props.accounts.map((account): PreviewRow => {
      if (numericAmount === null || numericAmount < 0) {
        return {
          account,
          target: null,
          error: t('Enter a whole number.'),
          remaining: 0,
        }
      }
      const target = targetFor(account, mode, numericAmount)
      let error = ''
      if (target < 0 || target > maxCalls) {
        error = t('The new total must be between 0 and 1,000,000 calls.')
      } else if (target < account.used + account.reserved) {
        error = t('Below used + pending calls')
      }
      const remaining =
        account.expires_at > Date.now() / 1000
          ? Math.max(0, target - account.used - account.reserved)
          : 0
      return { account, target, error, remaining }
    })
  }, [mode, numericAmount, props.accounts, t])

  const reasonBytes = new TextEncoder().encode(reason.trim()).length
  let reasonError = ''
  if (!reason.trim()) reasonError = t('Reason for change is required.')
  else if (reasonBytes > maxReasonBytes) {
    reasonError = t('Reason is too long. Please shorten it.')
  }
  const previewInvalid = preview.some(
    (row) => row.target === null || !!row.error
  )
  const canSubmit =
    !props.busy && props.accounts.length > 0 && !previewInvalid && !reasonError

  function applyAmountLabel(): string {
    if (mode === 'add') return t('Calls to add')
    if (mode === 'subtract') return t('Calls to subtract')
    return t('New total calls')
  }

  async function submit(): Promise<void> {
    if (!canSubmit || submitting.current) return
    submitting.current = true
    try {
      const ok = await props.save({
        section: 'account',
        action: 'batch_quota',
        reason: reason.trim(),
        targets: preview.map((row) => ({
          user_id: row.account.user_id,
          expected_limit: row.account.limit,
          target_calls: row.target,
        })),
      })
      if (ok) props.onSaved()
    } finally {
      submitting.current = false
    }
  }

  return (
    <Card className='min-w-0 border border-blue-100 bg-white'>
      <CardHeader className='min-w-0 gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between'>
        <CardTitle>{t('Adjust trial quota')}</CardTitle>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <p role='status' aria-live='polite' className='text-sm'>
            {t('{{count}} selected', { count: props.accounts.length })}
          </p>
          <Button
            variant='outline'
            disabled={props.busy || open}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            {t('Adjust quota')}
          </Button>
          <Button variant='ghost' disabled={props.busy} onClick={props.onClear}>
            {t('Clear selection')}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent className='min-w-0'>
          <fieldset
            className='min-w-0 space-y-4'
            disabled={props.busy}
            aria-busy={props.busy}
          >
            <p className='text-sm text-slate-500'>
              {t(
                'Only trial calls are changed. Expiry, model, account status and paid or permanent quota are not changed.'
              )}
            </p>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='batch-quota-mode'>
                  {t('Adjustment method')}
                </Label>
                <select
                  id='batch-quota-mode'
                  className='border-input bg-background h-10 w-full rounded-lg border px-3 text-sm'
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as AdjustmentMode)
                  }
                >
                  <option value='add'>{t('Add calls')}</option>
                  <option value='subtract'>{t('Subtract calls')}</option>
                  <option value='set'>{t('Set total calls')}</option>
                </select>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='batch-quota-amount'>{applyAmountLabel()}</Label>
                <Input
                  id='batch-quota-amount'
                  type='number'
                  min='0'
                  max={maxCalls}
                  step='1'
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  autoComplete='off'
                />
              </div>
              <div className='space-y-2 sm:col-span-2'>
                <Label htmlFor='batch-quota-reason'>
                  {t('Reason for change')}
                </Label>
                <Input
                  id='batch-quota-reason'
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  autoComplete='off'
                  aria-invalid={!!reasonError}
                  aria-describedby={
                    reasonError ? 'batch-quota-reason-error' : undefined
                  }
                />
                {reasonError && (
                  <p
                    id='batch-quota-reason-error'
                    role='alert'
                    className='text-sm text-red-600'
                  >
                    {reasonError}
                  </p>
                )}
              </div>
            </div>
            <div className='min-w-0 space-y-2'>
              <p className='text-sm font-medium'>{t('Preview')}</p>
              <p className='text-sm text-slate-500'>
                {t('The expiry date is unchanged.')}
              </p>
              {previewInvalid && (
                <p role='alert' className='text-sm text-red-600'>
                  {t('Some selected accounts cannot use this adjustment.')}
                </p>
              )}
              <StaticDataTable
                className='max-w-full min-w-0'
                data={preview}
                getRowKey={(row) => row.account.user_id}
                columns={[
                  {
                    id: 'account',
                    header: t('Account'),
                    cell: (row) =>
                      `${row.account.display_name} · ${row.account.user_id}`,
                  },
                  {
                    id: 'current',
                    header: t('Current total'),
                    cell: (row) => formatNumber(row.account.limit),
                  },
                  {
                    id: 'used',
                    header: t('Used / pending'),
                    cell: (row) =>
                      `${formatNumber(row.account.used)} / ${formatNumber(row.account.reserved)}`,
                  },
                  {
                    id: 'target',
                    header: t('New total'),
                    cell: (row) => (
                      <div>
                        <span
                          className={row.error ? 'text-red-600' : undefined}
                        >
                          {row.target === null ? '—' : formatNumber(row.target)}
                        </span>
                        {row.error && (
                          <small className='block text-red-600'>
                            {row.error}
                          </small>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: 'remaining',
                    header: t('Estimated remaining'),
                    cell: (row) =>
                      row.error || row.target === null
                        ? '—'
                        : formatNumber(row.remaining),
                  },
                ]}
              />
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button
                disabled={props.busy || !canSubmit}
                onClick={() => void submit()}
              >
                {t('Apply to selected accounts')}
              </Button>
              <Button variant='ghost' onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
            </div>
          </fieldset>
        </CardContent>
      )}
    </Card>
  )
}
