import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

// The administrator editor works with the complete policy returned by the
// server. The nested input never carries a revision: the expected revision is
// a separate top-level concurrency token on the save request.
export interface ContextRuntimePolicy {
  enabled: boolean
  system_prompt: string
  retrieval_budget: number
  retrieval_order: string[]
}

export interface ContextLearningPolicy {
  enabled: boolean
  vision_enabled: boolean
  allowed_sources: string[]
  max_calls_per_product: number
  max_output_tokens: number
  requires_review: boolean
  video_mode: string
  asr_mode: string
}

export interface ManagedContextPolicy {
  revision: number
  runtime_context: ContextRuntimePolicy
  learning: ContextLearningPolicy
}

export interface ContextPolicyInput {
  runtime_context: ContextRuntimePolicy
  learning: ContextLearningPolicy
}

export type ContextPolicyPayload = Record<string, unknown> & {
  section: 'context_policy'
  revision: number
  context_policy: ContextPolicyInput
}

export interface ContextPolicySaveSuccess {
  saved: true
  context_policy?: ManagedContextPolicy
}

export interface ContextPolicySaveConflict {
  saved: false
  unconfirmed: false
  conflict: true
  revision: number
}

export interface ContextPolicySaveFailure {
  saved: false
  unconfirmed: boolean
}

export type ContextPolicySave = (
  payload: ContextPolicyPayload
) => Promise<
  | ContextPolicySaveSuccess
  | ContextPolicySaveConflict
  | ContextPolicySaveFailure
  | false
>

interface AdminContextPolicyProps {
  policy?: ManagedContextPolicy
  busy: boolean
  save: ContextPolicySave
  refresh: () => Promise<ManagedContextPolicy | undefined>
}

type SaveStatus =
  | { kind: 'saved'; revision: number }
  | { kind: 'not_saved' }
  | { kind: 'unconfirmed' }
  | { kind: 'unconfirmed_response' }
  | { kind: 'refresh_failed' }
  | null

const PROMPT_MAX_BYTES = 8192
const BUDGET_MIN = 256
const BUDGET_MAX = 4096
const CALLS_MIN = 1
const CALLS_MAX = 20
const OUTPUT_MIN = 512
const OUTPUT_MAX = 4096
const LEARNING_SOURCES = ['pdd_detail_text', 'pdd_detail_image'] as const

function clonePolicy(policy: ManagedContextPolicy): ManagedContextPolicy {
  return {
    revision: policy.revision,
    runtime_context: {
      enabled: policy.runtime_context.enabled,
      system_prompt: policy.runtime_context.system_prompt,
      retrieval_budget: policy.runtime_context.retrieval_budget,
      retrieval_order: [...policy.runtime_context.retrieval_order],
    },
    learning: {
      enabled: policy.learning.enabled,
      vision_enabled: policy.learning.vision_enabled,
      allowed_sources: [...policy.learning.allowed_sources],
      max_calls_per_product: policy.learning.max_calls_per_product,
      max_output_tokens: policy.learning.max_output_tokens,
      requires_review: policy.learning.requires_review,
      video_mode: policy.learning.video_mode,
      asr_mode: policy.learning.asr_mode,
    },
  }
}

function policyInput(policy: ManagedContextPolicy): ContextPolicyInput {
  return {
    runtime_context: {
      enabled: policy.runtime_context.enabled,
      system_prompt: policy.runtime_context.system_prompt,
      retrieval_budget: policy.runtime_context.retrieval_budget,
      retrieval_order: [...policy.runtime_context.retrieval_order],
    },
    learning: {
      enabled: policy.learning.enabled,
      vision_enabled: policy.learning.vision_enabled,
      allowed_sources: [...policy.learning.allowed_sources],
      max_calls_per_product: policy.learning.max_calls_per_product,
      max_output_tokens: policy.learning.max_output_tokens,
      requires_review: policy.learning.requires_review,
      video_mode: policy.learning.video_mode,
      asr_mode: policy.learning.asr_mode,
    },
  }
}

function promptByteLength(prompt: string): number {
  return new TextEncoder().encode(prompt).byteLength
}

function isWellFormedText(value: string): boolean {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    value
  )
}

function integerInRange(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max
}

function validRetrievalOrder(order: string[]): boolean {
  if (
    order.length !== 4 ||
    order[0] !== 'binding' ||
    order[3] !== 'template'
  ) {
    return false
  }
  const middle = order.slice(1, 3)
  return (
    middle.includes('store') &&
    middle.includes('canonical') &&
    middle[0] !== middle[1]
  )
}

// Keys are English source strings so the existing translation catalog can
// localize them. Validation messages never include the hidden prompt text.
function validatePolicy(policy: ManagedContextPolicy): string[] {
  const errors: string[] = []
  if (!isWellFormedText(policy.runtime_context.system_prompt)) {
    errors.push('The hidden prompt must be valid UTF-8 text.')
  }
  if (
    promptByteLength(policy.runtime_context.system_prompt) > PROMPT_MAX_BYTES
  ) {
    errors.push(
      'The hidden prompt must not exceed 8192 UTF-8 bytes.'
    )
  }
  if (
    !integerInRange(
      policy.runtime_context.retrieval_budget,
      BUDGET_MIN,
      BUDGET_MAX
    )
  ) {
    errors.push(
      'Retrieval budget must be between 256 and 4096 tokens.'
    )
  }
  if (!validRetrievalOrder(policy.runtime_context.retrieval_order)) {
    errors.push(
      'Retrieval order must start with binding, end with template, and use store and canonical once.'
    )
  }
  if (
    !integerInRange(
      policy.learning.max_calls_per_product,
      CALLS_MIN,
      CALLS_MAX
    )
  ) {
    errors.push('Calls per product must be between 1 and 20.')
  }
  if (
    !integerInRange(
      policy.learning.max_output_tokens,
      OUTPUT_MIN,
      OUTPUT_MAX
    )
  ) {
    errors.push('Learning output must be between 512 and 4096 tokens.')
  }
  if (!policy.learning.requires_review) {
    errors.push('Human review is required and cannot be disabled.')
  }
  if (policy.learning.video_mode !== 'disabled') {
    errors.push('Video learning is not available.')
  }
  if (policy.learning.asr_mode !== 'disabled') {
    errors.push('Speech recognition is not available.')
  }
  for (const source of policy.learning.allowed_sources) {
    if (!LEARNING_SOURCES.includes(source as (typeof LEARNING_SOURCES)[number])) {
      errors.push(
        'Only product detail text and images can be used for learning.'
      )
      break
    }
  }
  if (policy.learning.enabled && policy.learning.allowed_sources.length === 0) {
    errors.push('Enable at least one learning source or turn learning off.')
  }
  return errors
}

export function AdminContextPolicy(props: AdminContextPolicyProps) {
  const { t } = useTranslation()
  const dirty = useRef(false)
  const loadedRevision = useRef(props.policy?.revision)
  const flight = useRef(false)
  const [draft, setDraft] = useState<ManagedContextPolicy | undefined>(() =>
    props.policy ? clonePolicy(props.policy) : undefined
  )
  const [status, setStatus] = useState<SaveStatus>(null)
  const [conflictRevision, setConflictRevision] = useState<number>()
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // A refetch may replace the loaded policy at any time. Only an explicit
  // refresh click may discard a dirty draft; otherwise an administrator would
  // silently lose edits to a background query invalidation.
  useEffect(() => {
    if (dirty.current) return
    const next = props.policy
    if (!next) {
      setDraft(undefined)
      loadedRevision.current = undefined
      return
    }
    if (
      loadedRevision.current !== undefined &&
      loadedRevision.current !== next.revision
    ) {
      setStatus(null)
      setConflictRevision(undefined)
    }
    loadedRevision.current = next.revision
    setDraft(clonePolicy(next))
  }, [props.policy])

  const disabled = props.busy || submitting || refreshing
  const errors = draft ? validatePolicy(draft) : []
  const canSave = !!draft && !disabled && errors.length === 0

  function editRuntime<K extends keyof ContextRuntimePolicy>(
    key: K,
    value: ContextRuntimePolicy[K]
  ) {
    dirty.current = true
    setStatus(null)
    setDraft((previous) =>
      previous
        ? {
            ...previous,
            runtime_context: { ...previous.runtime_context, [key]: value },
          }
        : previous
    )
  }

  function editLearning<K extends keyof ContextLearningPolicy>(
    key: K,
    value: ContextLearningPolicy[K]
  ) {
    dirty.current = true
    setStatus(null)
    setDraft((previous) =>
      previous
        ? {
            ...previous,
            learning: { ...previous.learning, [key]: value },
          }
        : previous
    )
  }

  function toggleSource(source: string) {
    if (!draft) return
    const sources = draft.learning.allowed_sources.includes(source)
      ? draft.learning.allowed_sources.filter((value) => value !== source)
      : [...draft.learning.allowed_sources, source]
    editLearning('allowed_sources', sources)
  }

  function setMiddleOrder(value: string) {
    const middle =
      value === 'canonical-store'
        ? ['canonical', 'store']
        : ['store', 'canonical']
    editRuntime('retrieval_order', ['binding', ...middle, 'template'])
  }

  async function submit() {
    if (!draft || !canSave || flight.current) return
    flight.current = true
    setSubmitting(true)
    setStatus(null)
    try {
      const result = await props.save({
        section: 'context_policy',
        revision: draft.revision,
        context_policy: policyInput(draft),
      })
      if (!result) {
        setStatus({ kind: 'not_saved' })
        return
      }
      if (result.saved) {
        if (!result.context_policy) {
          setStatus({ kind: 'unconfirmed_response' })
          return
        }
        const saved = clonePolicy(result.context_policy)
        dirty.current = false
        loadedRevision.current = saved.revision
        setDraft(saved)
        setConflictRevision(undefined)
        setStatus({ kind: 'saved', revision: saved.revision })
        return
      }
      if ('conflict' in result && result.conflict) {
        setConflictRevision(result.revision)
        return
      }
      setStatus({ kind: result.unconfirmed ? 'unconfirmed' : 'not_saved' })
    } catch {
      setStatus({ kind: 'unconfirmed' })
    } finally {
      flight.current = false
      setSubmitting(false)
    }
  }

  async function reload() {
    if (disabled) return
    setRefreshing(true)
    setStatus(null)
    try {
      const next = await props.refresh()
      if (!next) {
        setStatus({ kind: 'refresh_failed' })
        return
      }
      const loaded = clonePolicy(next)
      dirty.current = false
      loadedRevision.current = loaded.revision
      setDraft(loaded)
      setConflictRevision(undefined)
    } catch {
      setStatus({ kind: 'refresh_failed' })
    } finally {
      setRefreshing(false)
    }
  }

  if (!draft) {
    return (
      <Card className='max-w-3xl border border-blue-100 bg-white'>
        <CardHeader>
          <CardTitle>{t('Hosted model context')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          <p role='alert' className='text-sm text-amber-800'>
            {t(
              'Hosted context policy configuration is unavailable on this server. This editor will not save until the server provides a complete policy.'
            )}
          </p>
          <Button disabled>{t('Save context policy')}</Button>
        </CardContent>
      </Card>
    )
  }

  const order = draft.runtime_context.retrieval_order
  const middleOrder =
    order[1] === 'canonical' && order[2] === 'store'
      ? 'canonical-store'
      : 'store-canonical'

  return (
    <Card className='max-w-3xl border border-blue-100 bg-white'>
      <CardHeader>
        <CardTitle>{t('Hosted model context')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-5'>
        <p className='text-sm text-slate-500'>
          {t(
            'Configure the managed reception prompt, retrieval budget and learning policy. This policy applies only to hosted model requests.'
          )}
        </p>
        <p className='text-sm font-medium'>
          {`${t('Revision')}: ${draft.revision}`}
        </p>
        {status?.kind === 'saved' && (
          <p role='status' className='text-sm text-emerald-700'>
            {t('Changes saved. Revision {{revision}} is now active.', {
              revision: status.revision,
            })}
          </p>
        )}
        {status?.kind === 'not_saved' && (
          <p role='alert' className='text-sm text-red-700'>
            {t(
              'Changes were not saved. Verify administrator identity and try again.'
            )}
          </p>
        )}
        {status?.kind === 'unconfirmed' && (
          <p role='alert' className='text-sm text-red-700'>
            {t(
              'Save could not be confirmed. Refresh configuration and review before retrying.'
            )}
          </p>
        )}
        {status?.kind === 'unconfirmed_response' && (
          <p role='alert' className='text-sm text-red-700'>
            {t(
              'The server did not confirm the current revision. Refresh to verify before editing again.'
            )}
          </p>
        )}
        {status?.kind === 'refresh_failed' && (
          <p role='alert' className='text-sm text-red-700'>
            {t(
              'The latest configuration could not be loaded. Your draft is preserved.'
            )}
          </p>
        )}
        {conflictRevision !== undefined && (
          <div
            role='alert'
            className='space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900'
          >
            <p>
              {t('The configuration has changed. Latest revision {{revision}}.', {
                revision: conflictRevision,
              })}
            </p>
            <p>
              {t(
                'Your unsaved draft is preserved. Refresh to load the latest configuration.'
              )}
            </p>
            <Button
              type='button'
              variant='outline'
              disabled={disabled}
              onClick={() => void reload()}
            >
              {t('Refresh latest configuration')}
            </Button>
          </div>
        )}
        {errors.length > 0 && (
          <div
            role='alert'
            className='rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700'
          >
            <ul className='list-disc space-y-1 pl-5'>
              {errors.map((error) => (
                <li key={error}>{t(error)}</li>
              ))}
            </ul>
          </div>
        )}
        <div className='flex items-center justify-between'>
          <Label htmlFor='context-runtime-enabled'>
            {t('Runtime reception enabled')}
          </Label>
          <Switch
            id='context-runtime-enabled'
            disabled={disabled}
            checked={draft.runtime_context.enabled}
            onCheckedChange={(checked) =>
              editRuntime('enabled', checked === true)
            }
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='context-system-prompt'>
            {t('Hidden system prompt')}
          </Label>
          <Textarea
            id='context-system-prompt'
            className='font-mono'
            rows={6}
            disabled={disabled}
            value={draft.runtime_context.system_prompt}
            onChange={(event) =>
              editRuntime('system_prompt', event.target.value)
            }
          />
          <p className='text-xs text-slate-500'>
            {`${promptByteLength(
              draft.runtime_context.system_prompt
            )} / ${PROMPT_MAX_BYTES} UTF-8 bytes`}
          </p>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='context-retrieval-budget'>
            {t('Retrieval budget (tokens)')}
          </Label>
          <Input
            id='context-retrieval-budget'
            type='number'
            min={BUDGET_MIN}
            max={BUDGET_MAX}
            disabled={disabled}
            value={String(draft.runtime_context.retrieval_budget)}
            onChange={(event) =>
              editRuntime('retrieval_budget', Number(event.target.value))
            }
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='context-retrieval-order'>
            {t('Retrieval order after binding')}
          </Label>
          <select
            id='context-retrieval-order'
            disabled={disabled}
            value={middleOrder}
            onChange={(event) => setMiddleOrder(event.target.value)}
            className='border-input bg-background h-10 w-full rounded-lg border px-3 text-sm'
          >
            <option value='store-canonical'>{t('Store, then canonical')}</option>
            <option value='canonical-store'>{t('Canonical, then store')}</option>
          </select>
          <p className='text-xs text-slate-500'>
            {t('Binding is always first and template is always last.')}
          </p>
          <p className='text-xs text-slate-500'>{order.join(' → ')}</p>
        </div>
        <div className='space-y-3 rounded-lg border border-blue-100 p-3'>
          <h3 className='text-sm font-semibold'>{t('Learning policy')}</h3>
          <div className='flex items-center justify-between'>
            <Label htmlFor='context-learning-enabled'>
              {t('Detail-page learning')}
            </Label>
            <Switch
              id='context-learning-enabled'
              disabled={disabled}
              checked={draft.learning.enabled}
              onCheckedChange={(checked) =>
                editLearning('enabled', checked === true)
              }
            />
          </div>
          <div className='flex items-center justify-between'>
            <Label htmlFor='context-vision-enabled'>
              {t('Vision learning allowed')}
            </Label>
            <Switch
              id='context-vision-enabled'
              disabled={disabled}
              checked={draft.learning.vision_enabled}
              onCheckedChange={(checked) =>
                editLearning('vision_enabled', checked === true)
              }
            />
          </div>
          <fieldset
            className='space-y-2 rounded-lg border border-blue-100 p-3'
            disabled={disabled}
          >
            <legend className='px-1 text-sm'>{t('Allowed sources')}</legend>
            {LEARNING_SOURCES.map((source) => (
              <label key={source} className='flex items-center gap-2 text-sm'>
                <input
                  type='checkbox'
                  disabled={disabled}
                  checked={draft.learning.allowed_sources.includes(source)}
                  onChange={() => toggleSource(source)}
                />
                {t(
                  source === 'pdd_detail_text'
                    ? 'Product detail text'
                    : 'Product detail images'
                )}{' '}
                <code>{source}</code>
              </label>
            ))}
          </fieldset>
          <div className='space-y-2'>
            <Label htmlFor='context-calls'>
              {t('Calls per product (1-20)')}
            </Label>
            <Input
              id='context-calls'
              type='number'
              min={CALLS_MIN}
              max={CALLS_MAX}
              disabled={disabled}
              value={String(draft.learning.max_calls_per_product)}
              onChange={(event) =>
                editLearning(
                  'max_calls_per_product',
                  Number(event.target.value)
                )
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='context-output'>
              {t('Learning output tokens (512-4096)')}
            </Label>
            <Input
              id='context-output'
              type='number'
              min={OUTPUT_MIN}
              max={OUTPUT_MAX}
              disabled={disabled}
              value={String(draft.learning.max_output_tokens)}
              onChange={(event) =>
                editLearning(
                  'max_output_tokens',
                  Number(event.target.value)
                )
              }
            />
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='context-review'>
                {t('Human review required (read-only)')}
              </Label>
              <input
                id='context-review'
                type='checkbox'
                checked={draft.learning.requires_review}
                disabled
                readOnly
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='context-video'>
                {t('Video learning mode (read-only)')}
              </Label>
              <Input
                id='context-video'
                disabled
                readOnly
                value={draft.learning.video_mode}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='context-asr'>
                {t('Speech recognition mode (read-only)')}
              </Label>
              <Input
                id='context-asr'
                disabled
                readOnly
                value={draft.learning.asr_mode}
              />
            </div>
          </div>
        </div>
        <Button
          type='button'
          disabled={!canSave}
          onClick={() => void submit()}
        >
          {t('Save context policy')}
        </Button>
      </CardContent>
    </Card>
  )
}
