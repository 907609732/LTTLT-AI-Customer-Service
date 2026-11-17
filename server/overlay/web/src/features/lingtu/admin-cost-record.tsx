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
  historical_estimated_cny?: string
  historical_cost_micros?: number
  historical_cost_known?: boolean
  historical_cost_basis?: string
  historical_input_price_only?: boolean
  report_estimated_cny?: string
  report_cost_micros?: number
  report_cost_known?: boolean
}

export function CostRecordCell({ row }: { row: CostRecord }) {
  const { t } = useTranslation()
  const known = row.cost_known === true
  const historicalKnown = row.historical_cost_known === true
  const reportKnown = row.report_cost_known === true || known || historicalKnown
  const legacy =
    row.cost_known === undefined &&
    row.cost_basis !== 'unpriced' &&
    row.estimated_cny !== undefined
  let amount = t(costStatusMessage(row.cost_status))
  if (reportKnown) {
    amount = formatCostMicros(
      row.report_cost_micros ??
        row.cost_micros ??
        row.historical_cost_micros
    )
  } else if (legacy) {
    amount = formatCNY(row.estimated_cny)
  }
  return (
    <div>
      <strong>{amount}</strong>
      {known && (
        <small className='block'>
          <span>{t('Admission price snapshot')}</span>:{' '}
          {formatCostMicros(row.cost_micros)}
        </small>
      )}
      {historicalKnown && (
        <small className='block'>
          <span>{t('Historical current-rate estimate')}</span>:{' '}
          {formatCostMicros(row.historical_cost_micros)} ·{' '}
          {t(
            row.historical_input_price_only
              ? 'Estimated at input price because cache usage was not returned'
              : 'Saved cache price applied when cache usage was recorded'
          )}
        </small>
      )}
      {legacy && (
        <small className='block'>
          <span>
            {t(
              row.cost_basis === 'current_rates'
                ? 'Recalculated at current rates'
                : 'Admission price snapshot'
            )}
          </span>
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
