import { useTranslation } from 'react-i18next'

import { formatNumber } from '@/lib/format'

import { formatCNY } from './admin-cost-format'
import { costStatusMessage, formatCostMicros } from './cost-display'

export interface CostRecord {
  estimated_cny?: string
  cost_basis?: string
  cost_micros?: number
  cost_known?: boolean
  cost_status?: string
  cost_input_cny?: string
  cost_output_cny?: string
  cost_cache_read_cny?: string
  cache_read_tokens?: number
  cache_usage_known?: boolean
}

export function CostRecordCell({ row }: { row: CostRecord }) {
  const { t } = useTranslation()
  const known = row.cost_known === true
  const legacy =
    row.cost_known === undefined &&
    row.cost_basis !== 'unpriced' &&
    row.estimated_cny !== undefined
  let amount = t(costStatusMessage(row.cost_status))
  if (known) {
    amount = formatCostMicros(row.cost_micros)
  } else if (legacy) {
    amount = formatCNY(row.estimated_cny)
  }
  return (
    <div>
      <strong>{amount}</strong>
      {(known || legacy) && (
        <small className='block'>
          {t(
            row.cost_basis === 'current_rates'
              ? 'Recalculated at current rates'
              : 'Admission price snapshot'
          )}
        </small>
      )}
      <small className='block'>
        {t('Historical prices (CNY / million tokens)')}: {t('Input')}{' '}
        {row.cost_input_cny || '—'} / {t('Output')} {row.cost_output_cny || '—'}{' '}
        / {t('Cache read')} {row.cost_cache_read_cny || '—'}
      </small>
      <small className='block'>
        {t('Cache read tokens')}:{' '}
        {row.cache_usage_known === true
          ? formatNumber(row.cache_read_tokens)
          : t('Usage not returned')}
      </small>
    </div>
  )
}
