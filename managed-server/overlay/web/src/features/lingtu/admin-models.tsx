import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export interface ModelProvider {
  provider: string
  name: string
  category: string
  base_url: string
  upstream_model: string
  credential_format: string
  required_fields: string[]
  setup_url: string
}
export interface ModelConnection {
  connection_id: number
  provider: string
  name: string
  model_id: string
  base_url: string
  upstream_model: string
  api_version: string
  region: string
  account_id: string
  configured: boolean
  enabled: boolean
  ready: boolean
  is_default: boolean
  revision: number
  test_status: string
  tested_at: number
}
export type Payload = Record<string, unknown> & { section: string }
export interface SaveResult {
  saved: true
  tested?: boolean
  connection_id?: number
  model_connections?: ModelConnection[]
}
export interface SaveFailure {
  saved: false
  unconfirmed: boolean
}
export type ModelSave = (
  payload: Payload
) => Promise<SaveResult | SaveFailure | false>
interface Draft {
  key: string
  connection_id: number
  revision?: number
  name: string
  secret: string
  clear_secret: boolean
  base_url: string
  upstream_model: string
  api_version: string
  region: string
  account_id: string
  enabled: boolean
  dirty: boolean
  unconfirmedCreation?: boolean
}
const commonProviders = new Set([
  'doubao',
  'glm',
  'kimi',
  'claude',
  'gemini',
  'minimax',
])
const descriptions: Record<string, string> = {
  deepseek: 'Everyday customer conversations and complex questions',
  qwen: 'Chinese customer conversations',
  doubao: 'Chinese customer conversations',
  glm: 'Chinese conversations and complex questions',
  kimi: 'Long documents and multi-turn conversations',
  minimax: 'Multi-turn conversations and content understanding',
  claude: 'Complex conversations and long documents',
  gemini: 'Conversations and content understanding',
  openai: 'General customer conversations',
}
function fromSaved(row: ModelConnection): Draft {
  return {
    ...row,
    key: `saved-${row.connection_id}`,
    secret: '',
    clear_secret: false,
    dirty: false,
  }
}
function connectionStatus(rows: ModelConnection[], draft: boolean) {
  if (rows.some((row) => row.ready)) return 'Enabled'
  if (rows.some((row) => row.test_status === 'failed')) {
    return 'Connection test failed'
  }
  if (rows.some((row) => row.enabled)) return 'Awaiting connection test'
  if (rows.length) return 'Configured but disabled'
  return draft ? 'Unsaved draft' : 'Not configured'
}
export function AdminModels(props: {
  catalog: ModelProvider[]
  connections: ModelConnection[]
  save: ModelSave
  busy: boolean
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [provider, setProvider] = useState<ModelProvider | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft[]>>({})
  const [selection, setSelection] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [resultMessage, setResultMessage] = useState('')
  const serial = useRef(0)
  const submitting = useRef(false)
  function newDraft(p: ModelProvider, count: number): Draft {
    return {
      key: `draft-${++serial.current}`,
      connection_id: 0,
      name: `API ${count + 1}`,
      secret: '',
      clear_secret: false,
      base_url: p.base_url,
      upstream_model: p.upstream_model,
      api_version: '',
      region: '',
      account_id: '',
      enabled: true,
      dirty: true,
    }
  }
  function open(p: ModelProvider) {
    const saved = props.connections.filter((row) => row.provider === p.provider)
    const previous = drafts[p.provider] || []
    // Preserve dirty rows and append newly refreshed server rows by immutable ID.
    const next = previous
      .filter(
        (d) =>
          d.connection_id === 0 ||
          saved.some((row) => row.connection_id === d.connection_id)
      )
      .map((d) => {
        const persisted = saved.find(
          (row) => row.connection_id === d.connection_id
        )
        return d.dirty || !persisted ? d : fromSaved(persisted)
      })
    for (const row of saved) {
      if (!next.some((d) => d.connection_id === row.connection_id)) {
        next.push(fromSaved(row))
      }
    }
    if (!next.length) next.push(newDraft(p, 0))
    setDrafts((old) => ({ ...old, [p.provider]: next }))
    setSelection((old) => ({
      ...old,
      [p.provider]: next.some((d) => d.key === old[p.provider])
        ? old[p.provider]
        : next[0].key,
    }))
    setProvider(p)
    setVisible(false)
    setResultMessage('')
  }
  const rows = provider ? drafts[provider.provider] || [] : []
  const active = provider
    ? rows.find((row) => row.key === selection[provider.provider]) || rows[0]
    : undefined
  const saved = props.connections.find(
    (row) => row.connection_id === active?.connection_id
  )
  const revisionConflict = !!saved && saved.revision !== active?.revision
  const requiresRecovery = revisionConflict || !!active?.unconfirmedCreation
  function markUnconfirmed(captured: Draft, owner: string) {
    if (captured.connection_id !== 0) return
    setDrafts((old) => ({
      ...old,
      [owner]: old[owner].map((row) =>
        row.key === captured.key ? { ...row, unconfirmedCreation: true } : row
      ),
    }))
  }
  function reloadSaved() {
    if (!provider || !active || !saved || props.busy) return
    // This is an explicit local discard, never an automatic revision advance.
    // Only this API's draft/credential is replaced; no server write is made.
    setDrafts((old) => ({
      ...old,
      [provider.provider]: old[provider.provider].map((row) =>
        row.key === active.key ? fromSaved(saved) : row
      ),
    }))
    setVisible(false)
    setReloading(false)
    setResultMessage(
      'Saved API reloaded. Review the current settings before editing again.'
    )
  }
  function edit(patch: Partial<Draft>) {
    if (!provider || !active) return
    setDrafts((old) => ({
      ...old,
      [provider.provider]: old[provider.provider].map((row) =>
        row.key === active.key ? { ...row, ...patch, dirty: true } : row
      ),
    }))
  }
  function add() {
    if (!provider) return
    const next = newDraft(provider, rows.length)
    setDrafts((old) => ({ ...old, [provider.provider]: [...rows, next] }))
    setSelection((old) => ({ ...old, [provider.provider]: next.key }))
    setVisible(false)
  }
  async function submit(
    action: 'save' | 'test' | 'select' | 'delete',
    testAfterSave = false
  ) {
    if (!provider || !active || props.busy || submitting.current) return
    if (action === 'save' && requiresRecovery) return
    submitting.current = true
    setResultMessage('')
    const owner = provider.provider
    const captured = active
    const payload: Payload = {
      section: 'model_connection',
      provider: owner,
      action,
      connection_id: captured.connection_id,
      ...(captured.revision ? { revision: captured.revision } : {}),
    }
    if (action === 'save') {
      Object.assign(payload, {
        name: captured.name,
        base_url: captured.base_url,
        upstream_model: captured.upstream_model,
        enabled: captured.enabled,
        api_version: captured.api_version,
        region: captured.region,
        account_id: captured.account_id,
        ...(captured.secret.trim() ? { secret: captured.secret.trim() } : {}),
        ...(captured.clear_secret ? { clear_secret: true } : {}),
        ...(testAfterSave ? { test_after_save: true } : {}),
      })
    }
    try {
      const result = await props.save(payload)
      if (!result || !result.saved) {
        if (action === 'save' && result && result.unconfirmed)
          {markUnconfirmed(captured, owner)}
        setResultMessage(
          'Save could not be confirmed. Refresh configuration and review before retrying.'
        )
        return
      }
      if (action === 'delete') {
        setDrafts((old) => ({
          ...old,
          [owner]: old[owner].filter((row) => row.key !== captured.key),
        }))
        setProvider(null)
        return
      }
      if (action === 'save') {
        // Never infer a newly created API by its editable/nonunique name.
        const persisted = result.model_connections?.find(
          (row) =>
            row.connection_id === result.connection_id && row.provider === owner
        )
        if (!persisted) {
          markUnconfirmed(captured, owner)
          setResultMessage(
            'Save could not be confirmed. Refresh configuration and review before retrying.'
          )
          return
        }
        setDrafts((old) => ({
          ...old,
          [owner]: old[owner].map((row) =>
            row.key === captured.key ? fromSaved(persisted) : row
          ),
        }))
        setSelection((old) => ({
          ...old,
          [owner]: `saved-${persisted.connection_id}`,
        }))
        let message =
          'Configuration saved. Review the connection status before using it.'
        if (testAfterSave) {
          message = result.tested
            ? 'Configuration saved and connection tested. The default API is unchanged.'
            : 'Configuration saved, but the connection test failed. Review the settings and test again.'
        }
        setResultMessage(message)
      }
    } finally {
      submitting.current = false
    }
  }
  function removeDraft() {
    if (!provider || !active) return
    if (active.connection_id) {
      setDeleting(true)
      return
    }
    const next = rows.filter((row) => row.key !== active.key)
    setDrafts((old) => ({ ...old, [provider.provider]: next }))
    if (next.length) {
      setSelection((old) => ({ ...old, [provider.provider]: next[0].key }))
    } else setProvider(null)
  }
  const filtered = props.catalog.filter(
    (p) =>
      (category === 'all' || p.category === category) &&
      `${p.provider} ${p.name}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
  )
  const configured = filtered
    .filter((p) => props.connections.some((row) => row.provider === p.provider))
    .sort(
      (a, b) =>
        Number(
          props.connections.some(
            (row) => row.provider === b.provider && row.ready
          )
        ) -
        Number(
          props.connections.some(
            (row) => row.provider === a.provider && row.ready
          )
        )
    )
  const unconfigured = filtered.filter((p) => !configured.includes(p))
  const filtering = search.trim() !== '' || category !== 'all'
  const common = filtering
    ? unconfigured
    : unconfigured.filter((p) => commonProviders.has(p.provider))
  const remaining = filtering
    ? []
    : unconfigured.filter((p) => !commonProviders.has(p.provider))
  function cards(items: ModelProvider[]) {
    return (
      <div className='clear-model-grid'>
        {items.map((p) => {
          const connections = props.connections.filter(
            (row) => row.provider === p.provider
          )
          const status = connectionStatus(
            connections,
            !!drafts[p.provider]?.some((d) => d.dirty)
          )
          const ready = connections.some((row) => row.ready)
          let stateClass = 'empty'
          if (connections.length) stateClass = 'pending'
          if (ready) stateClass = 'ready'
          return (
            <article
              className='clear-model-card'
              key={p.provider}
              aria-label={p.name}
            >
              <button
                type='button'
                className='clear-card-heading'
                aria-label={`${t('Configure')} ${p.name}`}
                onClick={() => open(p)}
              >
                <span className='provider-mark'>{p.name.slice(0, 2)}</span>
                <span>
                  <b>{p.name}</b>
                  <small>{p.provider}</small>
                </span>
              </button>
              <p className='clear-card-description'>
                {t(
                  connections.some((row) => row.model_id === 'qwen3-vl-plus')
                    ? 'Chinese conversations. Existing Qwen3-VL image connection retained.'
                    : descriptions[p.provider] ||
                        'Native provider connection with independent API settings'
                )}
              </p>
              <div className='clear-card-statusline'>
                <span className={`clear-state ${stateClass}`}>
                  <i />
                  {t(status)}
                </span>
              </div>
              <div className='clear-card-foot'>
                {connections.length ? (
                  <span>
                    {connections.length} {t('API connections')}
                  </span>
                ) : (
                  <a
                    href={p.setup_url}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    {t('Get a key')} ↗
                  </a>
                )}
                <Button onClick={() => open(p)}>
                  {t(connections.length ? 'Manage' : 'Configure')}
                </Button>
              </div>
            </article>
          )
        })}
      </div>
    )
  }
  function section(title: string, items: ModelProvider[]) {
    return (
      items.length > 0 && (
        <section className='clear-section'>
          <h2>
            {t(title)}{' '}
            <span className='clear-section-count'>{items.length}</span>
          </h2>
          {cards(items)}
        </section>
      )
    )
  }
  return (
    <section aria-label={t('Models and keys')}>
      <p className='admin-intro'>
        {t('Configured models come first. Add another model when you need it.')}
      </p>
      <div className='catalog-toolbar'>
        <div role='group' aria-label={t('Provider category')}>
          {[
            ['all', 'All providers'],
            ['domestic', 'Mainland China'],
            ['global', 'Global'],
            ['platform', 'Cloud platforms'],
            ['selfhost', 'Self-hosted'],
          ].map(([id, label]) => (
            <Button
              key={id}
              variant={category === id ? 'secondary' : 'ghost'}
              aria-pressed={category === id}
              onClick={() => setCategory(id)}
            >
              {t(label)}
            </Button>
          ))}
        </div>
        <Input
          aria-label={t('Search models')}
          placeholder={t('Search models')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {section('Configured', configured)}
      {section('Add other models', common)}
      {remaining.length > 0 && (
        <details className='clear-more-models'>
          <summary>
            {t('Other models and platforms')} · {remaining.length}
          </summary>
          {cards(remaining)}
        </details>
      )}
      {!filtered.length && (
        <p role='status' className='clear-empty'>
          {t('No matching models. Try another name.')}
        </p>
      )}
      <Dialog
        open={!!provider}
        onOpenChange={(open) => {
          if (!open && !props.busy) setProvider(null)
        }}
      >
        <DialogContent
          className='lingtu-admin-light lingtu-admin-shell model-dialog'
          showCloseButton={false}
        >
          <DialogHeader>
            <DialogTitle>{provider?.name}</DialogTitle>
            <DialogDescription>
              {t('Enter your key to configure this model.')}
            </DialogDescription>
          </DialogHeader>
          {provider && active && (
            <>
              <div className='simple-api-picker'>
                <select
                  aria-label={t('API connection')}
                  disabled={props.busy}
                  value={active.key}
                  onChange={(e) => {
                    setSelection((old) => ({
                      ...old,
                      [provider.provider]: e.target.value,
                    }))
                    setVisible(false)
                  }}
                >
                  {rows.map((row) => (
                    <option key={row.key} value={row.key}>
                      {row.name}
                      {props.connections.find(
                        (item) => item.connection_id === row.connection_id
                      )?.is_default
                        ? ` · ${t('Current default')}`
                        : ''}
                      {row.dirty ? ` · ${t('Draft')}` : ''}
                    </option>
                  ))}
                </select>
                <Button variant='outline' disabled={props.busy} onClick={add}>
                  {t('Add API')}
                </Button>
              </div>
              {revisionConflict && saved && (
                <div className='admin-message' role='alert'>
                  <p>
                    {t(
                      'The saved API changed. Reload its current settings before saving again. This draft has not been discarded.'
                    )}
                  </p>
                  <p className='admin-help'>
                    {t('Saved API')}: {saved.name} · {saved.upstream_model} ·{' '}
                    {t('Revision')} {saved.revision}
                  </p>
                  <Button
                    variant='outline'
                    disabled={props.busy}
                    onClick={() => setReloading(true)}
                  >
                    {t('Reload saved API')}
                  </Button>
                </div>
              )}
              {active.unconfirmedCreation && (
                <div className='admin-message' role='alert'>
                  <p>
                    {t(
                      'A new API may already have been saved. Review saved APIs before creating another. No connection is matched automatically.'
                    )}
                  </p>
                  <Button
                    variant='outline'
                    disabled={props.busy}
                    onClick={() => open(provider)}
                  >
                    {t('Review saved APIs')}
                  </Button>
                </div>
              )}
              <div className='simple-key-label'>
                <Label htmlFor='connection-secret'>{t('Model key')}</Label>
                <a
                  href={provider.setup_url}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {t('Get a key')} ↗
                </a>
              </div>
              <p className='admin-help'>{t(provider.credential_format)}</p>
              <div className='simple-key-wrap'>
                {provider.provider === 'vertex' ? (
                  <textarea
                    className={visible ? '' : 'secret-masked'}
                    id='connection-secret'
                    disabled={props.busy}
                    aria-label={t('Model key')}
                    autoComplete='new-password'
                    spellCheck={false}
                    value={active.secret}
                    onChange={(e) =>
                      edit({ secret: e.target.value, clear_secret: false })
                    }
                  />
                ) : (
                  <Input
                    id='connection-secret'
                    type={visible ? 'text' : 'password'}
                    disabled={props.busy}
                    autoComplete='new-password'
                    spellCheck={false}
                    value={active.secret}
                    placeholder={t(
                      saved?.configured
                        ? 'Configured. Leave blank to keep.'
                        : 'Paste a key to configure'
                    )}
                    onChange={(e) =>
                      edit({ secret: e.target.value, clear_secret: false })
                    }
                  />
                )}
                <Button variant='ghost' onClick={() => setVisible(!visible)}>
                  {t(visible ? 'Hide' : 'Show')}
                </Button>
              </div>
              <p className='admin-help'>
                {t(
                  saved?.configured
                    ? 'Leave blank to retain the encrypted key.'
                    : 'Keys are stored encrypted on the server.'
                )}
              </p>
              <div className='simple-current'>
                <span>
                  {saved?.is_default ? `${t('Current default')} · ` : ''}
                  {t(connectionStatus(saved ? [saved] : [], true))}
                  {active.dirty ? ` · ${t('Unsaved changes')}` : ''}
                </span>
                <Button
                  variant='ghost'
                  disabled={
                    props.busy ||
                    active.dirty ||
                    !saved?.ready ||
                    saved.test_status !== 'success' ||
                    saved.is_default
                  }
                  onClick={() => void submit('select')}
                >
                  {t('Use this API')}
                </Button>
              </div>
              {provider.required_fields
                .filter(
                  (key) =>
                    key === 'api_version' ||
                    key === 'region' ||
                    key === 'account_id'
                )
                .map((key) => (
                  <div className='space-y-2' key={key}>
                    <Label htmlFor={`connection-${key}`}>
                      {t(
                        (
                          {
                            api_version: 'API version',
                            region: 'Region',
                            account_id: 'Platform account ID',
                          } as Record<string, string>
                        )[key]
                      )}
                    </Label>
                    <Input
                      id={`connection-${key}`}
                      disabled={props.busy}
                      value={active[key as 'region']}
                      onChange={(e) => edit({ [key]: e.target.value })}
                    />
                  </div>
                ))}
              <details
                className='simple-advanced'
                open={
                  provider.category === 'selfhost' ||
                  provider.provider === 'compatible' ||
                  !active.upstream_model ||
                  (!active.base_url && provider.provider !== 'bedrock')
                    ? true
                    : undefined
                }
              >
                <summary>{t('More settings (usually unchanged)')}</summary>
                <div className='simple-advanced-fields'>
                  <Label htmlFor='connection-name'>{t('API name')}</Label>
                  <Input
                    id='connection-name'
                    disabled={props.busy}
                    value={active.name}
                    onChange={(e) => edit({ name: e.target.value })}
                  />
                  <Label htmlFor='connection-url'>{t('API endpoint')}</Label>
                  <Input
                    id='connection-url'
                    disabled={
                      props.busy ||
                      provider.provider === 'bedrock' ||
                      provider.provider === 'spark'
                    }
                    value={active.base_url}
                    onChange={(e) => edit({ base_url: e.target.value })}
                  />
                  <Label htmlFor='connection-model'>
                    {t('Upstream model ID')}
                  </Label>
                  <Input
                    id='connection-model'
                    disabled={props.busy}
                    value={active.upstream_model}
                    onChange={(e) => edit({ upstream_model: e.target.value })}
                  />
                  <div className='flex items-center justify-between'>
                    <Label htmlFor='connection-enabled'>
                      {t('Enable after successful test')}
                    </Label>
                    <Switch
                      id='connection-enabled'
                      disabled={props.busy}
                      checked={active.enabled}
                      onCheckedChange={(enabled) => edit({ enabled })}
                    />
                  </div>
                  {saved?.configured && (
                    <label className='flex gap-2'>
                      <input
                        type='checkbox'
                        disabled={props.busy}
                        checked={active.clear_secret}
                        onChange={(e) =>
                          edit({
                            clear_secret: e.target.checked,
                            secret: '',
                            enabled: e.target.checked ? false : active.enabled,
                          })
                        }
                      />
                      {t('Clear stored credential and disable')}
                    </label>
                  )}
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      variant='outline'
                      disabled={
                        props.busy || requiresRecovery || !active.name.trim()
                      }
                      onClick={() => void submit('save')}
                    >
                      {t('Save without testing')}
                    </Button>
                    <Button
                      variant='outline'
                      disabled={props.busy || active.dirty || !saved}
                      onClick={() => void submit('test')}
                    >
                      {t('Test saved API')}
                    </Button>
                    <Button
                      variant='destructive'
                      disabled={props.busy || !!saved?.is_default}
                      onClick={removeDraft}
                    >
                      {t('Delete this API')}
                    </Button>
                  </div>
                </div>
              </details>
              <p className='admin-help'>
                {t(
                  'Testing sends a short model request and may incur a small charge. Saving and testing never changes the default API.'
                )}
              </p>
              {resultMessage && (
                <p role='status' className='admin-message'>
                  {t(resultMessage)}
                </p>
              )}
              <div className='simple-modal-footer'>
                <Button
                  variant='outline'
                  disabled={props.busy}
                  onClick={() => setProvider(null)}
                >
                  {t('Back')}
                </Button>
                <Button
                  disabled={
                    props.busy ||
                    requiresRecovery ||
                    !active.name.trim() ||
                    !active.upstream_model.trim()
                  }
                  onClick={() => void submit('save', true)}
                >
                  {t(props.busy ? 'Working. Please wait...' : 'Save and test')}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        className='lingtu-admin-light lingtu-admin-shell'
        open={reloading}
        onOpenChange={setReloading}
        title={t('Reload saved API')}
        desc={t(
          'Discard only this API draft, including its typed credential, and load the latest saved settings. Other API drafts are kept. This does not change the server.'
        )}
        confirmText={t('Discard this draft and reload')}
        disabled={props.busy}
        handleConfirm={reloadSaved}
      />
      <ConfirmDialog
        className='lingtu-admin-light lingtu-admin-shell'
        confirmText={t('Delete this API')}
        open={deleting}
        onOpenChange={setDeleting}
        title={t('Delete this API')}
        desc={t(
          'Delete only this saved API. Assigned accounts and the current default must be changed first.'
        )}
        destructive
        handleConfirm={() => {
          setDeleting(false)
          void submit('delete')
        }}
      />
    </section>
  )
}
