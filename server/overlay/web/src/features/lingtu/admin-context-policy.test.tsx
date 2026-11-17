import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import {
  AdminContextPolicy,
  type ContextPolicyPayload,
  type ContextPolicySave,
  type ManagedContextPolicy,
} from './admin-context-policy'

const policy: ManagedContextPolicy = {
  revision: 4,
  runtime_context: {
    enabled: true,
    system_prompt: 'Answer with approved facts only.',
    retrieval_budget: 3000,
    retrieval_order: ['binding', 'store', 'canonical', 'template'],
  },
  learning: {
    enabled: false,
    vision_enabled: true,
    allowed_sources: ['pdd_detail_text', 'pdd_detail_image'],
    max_calls_per_product: 20,
    max_output_tokens: 4096,
    requires_review: true,
    video_mode: 'disabled',
    asr_mode: 'disabled',
  },
}

function show(props: {
  policy?: ManagedContextPolicy | null
  busy?: boolean
  save?: ContextPolicySave
  refresh?: () => Promise<ManagedContextPolicy | undefined>
} = {}) {
  const save =
    props.save ??
    (vi.fn(async () => ({
      saved: true as const,
      context_policy: policy,
    })) as unknown as ContextPolicySave)
  const refresh = props.refresh ?? vi.fn(async () => policy)
  const view = render(
    <AdminContextPolicy
      policy={props.policy === null ? undefined : (props.policy ?? policy)}
      busy={props.busy ?? false}
      save={save}
      refresh={refresh}
    />
  )
  return { save, refresh, view }
}

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
  i18next.addResourceBundle('zhCN', 'translation', zh.translation, true, true)
  i18next.addResourceBundle('en', 'translation', en.translation, true, true)
  await i18next.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it('displays the Go defaults for a new hosted context policy', () => {
  show({
    policy: {
      revision: 0,
      runtime_context: {
        enabled: false,
        system_prompt: '',
        retrieval_budget: 3000,
        retrieval_order: ['binding', 'store', 'canonical', 'template'],
      },
      learning: {
        enabled: false,
        vision_enabled: true,
        allowed_sources: ['pdd_detail_text', 'pdd_detail_image'],
        max_calls_per_product: 20,
        max_output_tokens: 4096,
        requires_review: true,
        video_mode: 'disabled',
        asr_mode: 'disabled',
      },
    },
  })
  expect(screen.getByText('Revision: 0')).toBeTruthy()
  expect(
    screen.getByText(
      'The model learning endpoint does not write knowledge. Automatic detail-page collection is not connected, and the per-product call limit is not enforced yet.'
    )
  ).toBeTruthy()
  expect(
    (screen.getByLabelText('Retrieval budget (tokens)') as HTMLInputElement).value
  ).toBe('3000')
  expect(
    (screen.getByLabelText('Calls per product (1-20)') as HTMLInputElement).value
  ).toBe('20')
  expect(
    (
      screen.getByLabelText(
        'Learning output tokens (512-4096)'
      ) as HTMLInputElement
    ).value
  ).toBe('4096')
  expect(
    screen.getByRole('switch', { name: 'Runtime reception enabled' })
  ).toHaveAttribute('aria-checked', 'false')
  expect(
    screen.getByRole('switch', { name: 'Detail-page learning' })
  ).toHaveAttribute('aria-checked', 'false')
  expect(
    screen.getByRole('switch', { name: 'Vision learning allowed' })
  ).toHaveAttribute('aria-checked', 'true')
  for (const source of ['pdd_detail_text', 'pdd_detail_image']) {
    expect(
      (
        screen.getByRole('checkbox', {
          name: new RegExp(source),
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
  }
})

it('shows fixed review, video and speech constraints and saves the exact nested policy without a nested revision', async () => {
  const savedPolicy: ManagedContextPolicy = {
    ...policy,
    revision: 5,
    runtime_context: {
      ...policy.runtime_context,
      system_prompt: 'Use only reviewed sources.',
      retrieval_budget: 2048,
      retrieval_order: ['binding', 'canonical', 'store', 'template'],
    },
    learning: {
      ...policy.learning,
      enabled: true,
      max_calls_per_product: 12,
      max_output_tokens: 2048,
    },
  }
  let submitted: ContextPolicyPayload | undefined
  const save = vi.fn(async (payload: ContextPolicyPayload) => {
    submitted = payload
    return { saved: true as const, context_policy: savedPolicy }
  })
  show({ save })
  expect(screen.getByText('Revision: 4')).toBeTruthy()
  const review = screen.getByLabelText(
    'Human review required (read-only)'
  ) as HTMLInputElement
  expect(review.checked).toBe(true)
  expect(review.disabled).toBe(true)
  expect(
    (
      screen.getByLabelText(
        'Video learning mode (read-only)'
      ) as HTMLInputElement
    ).disabled
  ).toBe(true)
  expect(
    (
      screen.getByLabelText(
        'Speech recognition mode (read-only)'
      ) as HTMLInputElement
    ).disabled
  ).toBe(true)
  fireEvent.change(screen.getByLabelText('Hidden system prompt'), {
    target: { value: 'Use only reviewed sources.' },
  })
  fireEvent.change(screen.getByLabelText('Retrieval budget (tokens)'), {
    target: { value: '2048' },
  })
  fireEvent.change(screen.getByLabelText('Retrieval order after binding'), {
    target: { value: 'canonical-store' },
  })
  fireEvent.click(
    screen.getByRole('switch', { name: 'Detail-page learning' })
  )
  fireEvent.change(screen.getByLabelText('Calls per product (1-20)'), {
    target: { value: '12' },
  })
  fireEvent.change(
    screen.getByLabelText('Learning output tokens (512-4096)'),
    { target: { value: '2048' } }
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Save context policy' })
  )
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save).toHaveBeenCalledWith({
    section: 'context_policy',
    revision: 4,
    context_policy: {
      runtime_context: {
        enabled: true,
        system_prompt: 'Use only reviewed sources.',
        retrieval_budget: 2048,
        retrieval_order: ['binding', 'canonical', 'store', 'template'],
      },
      learning: {
        enabled: true,
        vision_enabled: true,
        allowed_sources: ['pdd_detail_text', 'pdd_detail_image'],
        max_calls_per_product: 12,
        max_output_tokens: 2048,
        requires_review: true,
        video_mode: 'disabled',
        asr_mode: 'disabled',
      },
    },
  })
  expect(submitted?.context_policy).not.toHaveProperty('revision')
  expect(await screen.findByText('Revision: 5')).toBeTruthy()
  expect(
    screen.getByText('Changes saved. Revision 5 is now active.')
  ).toBeTruthy()
})

it('blocks saving an overlong UTF-8 prompt and out-of-range learning values', () => {
  const save = vi.fn(async () => ({
    saved: true as const,
    context_policy: policy,
  }))
  show({ save: save as unknown as ContextPolicySave })
  const saveButton = screen.getByRole('button', {
    name: 'Save context policy',
  }) as HTMLButtonElement
  fireEvent.change(screen.getByLabelText('Hidden system prompt'), {
    target: { value: '灵'.repeat(2731) },
  })
  expect(
    screen.getByText('The hidden prompt must not exceed 8192 UTF-8 bytes.')
  ).toBeTruthy()
  expect(saveButton.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Hidden system prompt'), {
    target: { value: 'ok' },
  })
  fireEvent.change(screen.getByLabelText('Retrieval budget (tokens)'), {
    target: { value: '255' },
  })
  fireEvent.change(screen.getByLabelText('Calls per product (1-20)'), {
    target: { value: '21' },
  })
  fireEvent.change(
    screen.getByLabelText('Learning output tokens (512-4096)'),
    { target: { value: '511' } }
  )
  expect(
    screen.getByText('Retrieval budget must be between 256 and 4096 tokens.')
  ).toBeTruthy()
  expect(
    screen.getByText('Calls per product must be between 1 and 20.')
  ).toBeTruthy()
  expect(
    screen.getByText(
      'Learning output must be between 512 and 4096 tokens.'
    )
  ).toBeTruthy()
  expect(saveButton.disabled).toBe(true)
  expect(save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Retrieval budget (tokens)'), {
    target: { value: '256' },
  })
  fireEvent.change(screen.getByLabelText('Calls per product (1-20)'), {
    target: { value: '1' },
  })
  fireEvent.change(
    screen.getByLabelText('Learning output tokens (512-4096)'),
    { target: { value: '512' } }
  )
  expect(saveButton.disabled).toBe(false)
})

it('refuses to save a loaded policy that violates fixed review, video or speech constraints', () => {
  const save = vi.fn(async () => ({
    saved: true as const,
    context_policy: policy,
  }))
  show({
    policy: {
      ...policy,
      learning: {
        ...policy.learning,
        requires_review: false,
        video_mode: 'enabled',
        asr_mode: 'enabled',
      },
    },
    save: save as unknown as ContextPolicySave,
  })
  expect(
    screen.getByText('Human review is required and cannot be disabled.')
  ).toBeTruthy()
  expect(screen.getByText('Video learning is not available.')).toBeTruthy()
  expect(
    screen.getByText('Speech recognition is not available.')
  ).toBeTruthy()
  expect(
    (
      screen.getByRole('button', {
        name: 'Save context policy',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  expect(save).not.toHaveBeenCalled()
})

it('preserves a dirty draft across a query refresh and resets it only after the explicit conflict refresh', async () => {
  const refreshed: ManagedContextPolicy = {
    ...policy,
    revision: 5,
    runtime_context: {
      ...policy.runtime_context,
      system_prompt: 'Server latest prompt',
    },
  }
  const save = vi.fn(async () => ({
    saved: false as const,
    unconfirmed: false as const,
    conflict: true as const,
    revision: 5,
  }))
  const refresh = vi.fn(async () => refreshed)
  const { view } = show({
    save: save as unknown as ContextPolicySave,
    refresh,
  })
  const prompt = screen.getByLabelText(
    'Hidden system prompt'
  ) as HTMLTextAreaElement
  fireEvent.change(prompt, { target: { value: 'Unsaved draft prompt' } })
  view.rerender(
    <AdminContextPolicy
      policy={refreshed}
      busy={false}
      save={save as unknown as ContextPolicySave}
      refresh={refresh}
    />
  )
  expect(prompt.value).toBe('Unsaved draft prompt')
  fireEvent.click(
    screen.getByRole('button', { name: 'Save context policy' })
  )
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      revision: 4,
      context_policy: expect.objectContaining({
        runtime_context: expect.objectContaining({
          system_prompt: 'Unsaved draft prompt',
        }),
      }),
    })
  )
  expect(
    await screen.findByText('The configuration has changed. Latest revision 5.')
  ).toBeTruthy()
  expect(
    screen.getByText(
      'Your unsaved draft is preserved. Refresh to load the latest configuration.'
    )
  ).toBeTruthy()
  expect(prompt.value).toBe('Unsaved draft prompt')
  expect(refresh).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Refresh latest configuration' })
  )
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(prompt.value).toBe('Server latest prompt'))
  expect(screen.getByText('Revision: 5')).toBeTruthy()
  expect(
    screen.queryByText('The configuration has changed. Latest revision 5.')
  ).toBeNull()
})

it('preserves the draft when an explicit conflict refresh rejects', async () => {
  const save = vi.fn(async () => ({
    saved: false as const,
    unconfirmed: false as const,
    conflict: true as const,
    revision: 5,
  }))
  const refresh = vi.fn(async (): Promise<ManagedContextPolicy> => {
    throw new Error('fixture offline')
  })
  show({ save: save as unknown as ContextPolicySave, refresh })
  const prompt = screen.getByLabelText('Hidden system prompt') as HTMLTextAreaElement
  fireEvent.change(prompt, { target: { value: 'Keep this draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save context policy' }))
  await screen.findByText('The configuration has changed. Latest revision 5.')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh latest configuration' }))
  await screen.findByText('The latest configuration could not be loaded. Your draft is preserved.')
  expect(prompt.value).toBe('Keep this draft')
  expect(screen.getByText('Revision: 4')).toBeTruthy()
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('disables every control while busy and reports an unavailable policy without allowing a save', () => {
  const save = vi.fn(async () => ({
    saved: true as const,
    context_policy: policy,
  }))
  const { view } = show({
    busy: true,
    save: save as unknown as ContextPolicySave,
  })
  for (const label of [
    'Hidden system prompt',
    'Retrieval budget (tokens)',
    'Retrieval order after binding',
    'Calls per product (1-20)',
    'Learning output tokens (512-4096)',
  ]) {
    expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(
      true
    )
  }
  for (const name of [
    'Runtime reception enabled',
    'Detail-page learning',
    'Vision learning allowed',
  ]) {
    expect(
      screen.getByRole('switch', { name }).hasAttribute('data-disabled')
    ).toBe(true)
  }
  for (const source of ['pdd_detail_text', 'pdd_detail_image']) {
    expect(
      (
        screen.getByRole('checkbox', {
          name: new RegExp(source),
        }) as HTMLInputElement
      ).disabled
    ).toBe(true)
  }
  expect(
    (
      screen.getByRole('button', {
        name: 'Save context policy',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  view.rerender(
    <AdminContextPolicy
      policy={undefined}
      busy={false}
      save={save as unknown as ContextPolicySave}
      refresh={vi.fn(async () => undefined)}
    />
  )
  expect(screen.getByRole('alert').textContent).toContain(
    'Hosted context policy configuration is unavailable'
  )
  expect(screen.queryByLabelText('Hidden system prompt')).toBeNull()
  expect(
    (
      screen.getByRole('button', {
        name: 'Save context policy',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  expect(save).not.toHaveBeenCalled()
})
