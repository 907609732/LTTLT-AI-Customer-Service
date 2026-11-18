import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  sizeRuleFieldsSchema,
  sizeRuleFileSchema,
  sizeRuleRemovePayloadSchema,
  sizeRuleSavePayloadSchema,
  type SizeBindingStatus,
  type SizeRuleBinding,
  type SizeRuleFile,
  type SizeRuleRecord,
} from '../../src/shared/contracts/size-rules'
import {
  assertUniqueBindingOwnership,
  assertUniqueRuleIds,
  bindingKey,
  uniqueBindings,
} from './validate'

export interface SizeRuleStoreOptions {
  directory: string
  assertActive(): void
  checkBinding?(binding: SizeRuleBinding): Promise<SizeBindingStatus>
  /** Legacy boolean test port; production uses checkBinding to distinguish lookup errors. */
  isBindingValid?(binding: SizeRuleBinding): Promise<boolean>
  now?(): number
  id?(): string
  /** Test-only injection for proving the original file survives a failed atomic replace. */
  atomicWrite?(file: string, content: string): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function validationMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = Reflect.get(error, 'issues')
    if (Array.isArray(issues))
      return issues
        .slice(0, 3)
        .map((issue) => String(Reflect.get(issue as object, 'message') ?? ''))
        .filter(Boolean)
        .join('；')
  }
  return messageOf(error)
}

/** Write through a same-directory temp file; only fsync + rename makes the new state visible. */
export function writeSizeRulesAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(descriptor, content, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporary, file)
    // Directory fsync is best-effort on Windows; a failure after rename does not lose the new file.
    try {
      const directory = fs.openSync(path.dirname(file), 'r')
      try {
        fs.fsyncSync(directory)
      } finally {
        fs.closeSync(directory)
      }
    } catch {
      /* Windows does not always allow opening a directory as a file. */
    }
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor)
      } catch {
        /* The write error remains the actionable failure. */
      }
    }
    if (fs.existsSync(temporary)) {
      try {
        fs.unlinkSync(temporary)
      } catch {
        /* A locked temp file must not hide the original write failure. */
      }
    }
  }
}

export function createSizeRuleStore(options: SizeRuleStoreOptions) {
  const file = path.join(options.directory, 'size-rules.json')
  const write = options.atomicWrite ?? writeSizeRulesAtomic
  const now = options.now ?? Date.now
  const id = options.id ?? randomUUID
  const checkBinding =
    options.checkBinding ??
    (options.isBindingValid
      ? async (binding: SizeRuleBinding): Promise<SizeBindingStatus> =>
          (await options.isBindingValid!(binding)) ? 'valid' : 'missing'
      : async () => 'valid')
  let state = load()

  function load(): SizeRuleFile {
    options.assertActive()
    if (!fs.existsSync(file)) return { version: 1, revision: 0, rules: [] }
    try {
      const parsed = sizeRuleFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
      assertUniqueRuleIds(parsed.rules)
      assertUniqueBindingOwnership(parsed.rules)
      return parsed
    } catch (error) {
      throw new Error(`尺码规格数据损坏，原文件未改动，请恢复备份：${validationMessage(error)}`)
    }
  }

  function commit(next: SizeRuleFile): void {
    assertUniqueRuleIds(next.rules)
    assertUniqueBindingOwnership(next.rules)
    try {
      write(file, JSON.stringify(next))
    } catch {
      throw new Error('尺码规格保存失败，请检查数据目录权限；原文件未改动')
    }
    state = next
  }

  return {
    snapshot(): SizeRuleFile {
      options.assertActive()
      return structuredClone(state)
    },
    async save(input: unknown): Promise<{ rule: SizeRuleRecord; revision: number }> {
      options.assertActive()
      let value
      try {
        value = sizeRuleSavePayloadSchema.parse(input)
      } catch (error) {
        throw new Error(`尺码规格校验失败：${validationMessage(error)}`)
      }
      if (value.expectedRevision !== state.revision)
        throw new Error('尺码规格列表已更新，请刷新后重试')
      const old = value.id ? state.rules.find((rule) => rule.id === value.id) : undefined
      if (value.id && !old) throw new Error('尺码规格规则不存在，请刷新后重试')
      if (old && value.version !== old.version)
        throw new Error('尺码规格规则已更新，请重新载入后再保存')
      const { id: _id, version: _version, expectedRevision: _expected, ...fields } = value
      void _id
      void _version
      void _expected
      const data = sizeRuleFieldsSchema.parse(fields)
      for (const binding of uniqueBindings(data.bindings)) {
        options.assertActive()
        let status: SizeBindingStatus
        try {
          status = await checkBinding(binding)
        } catch {
          status = 'error'
        }
        if (status === 'error')
          throw new Error('商品目录暂时无法核对绑定，请稍后重试；原文件未改动')
        if (status === 'missing')
          throw new Error('绑定的店铺或商品不在当前商品目录中，请刷新后重新选择')
        options.assertActive()
      }
      // The catalog checks are asynchronous. Recheck both CAS tokens immediately before
      // the synchronous commit so two stale saves cannot both apply.
      if (state.revision !== value.expectedRevision)
        throw new Error('尺码规格列表已更新，请刷新后重试')
      if (value.id) {
        const concurrent = state.rules.find((rule) => rule.id === value.id)
        if (!concurrent || concurrent.version !== value.version)
          throw new Error('尺码规格规则已更新，请重新载入后再保存')
      }
      const nextRule: SizeRuleRecord = {
        ...data,
        id: old?.id ?? id(),
        version: (old?.version ?? 0) + 1,
        updatedAt: now(),
      }
      const rules = old
        ? state.rules.map((rule) => (rule.id === old.id ? nextRule : rule))
        : [...state.rules, nextRule]
      const next = sizeRuleFileSchema.parse({
        version: 1,
        revision: state.revision + 1,
        rules,
      })
      commit(next)
      options.assertActive()
      return { rule: structuredClone(nextRule), revision: next.revision }
    },
    remove(input: unknown): { revision: number } {
      options.assertActive()
      let value
      try {
        value = sizeRuleRemovePayloadSchema.parse(input)
      } catch {
        throw new Error('请确认删除尺码规格规则并解除商品绑定')
      }
      if (value.expectedRevision !== state.revision)
        throw new Error('尺码规格列表已更新，请刷新后重试')
      const old = state.rules.find((rule) => rule.id === value.id)
      if (!old) throw new Error('尺码规格规则不存在，请刷新后重试')
      if (old.version !== value.version) throw new Error('尺码规格规则已更新，请重新核对')
      const next = sizeRuleFileSchema.parse({
        version: 1,
        revision: state.revision + 1,
        rules: state.rules.filter((rule) => rule.id !== value.id),
      })
      commit(next)
      return { revision: next.revision }
    },
    has(binding: SizeRuleBinding): boolean {
      const key = bindingKey(binding)
      return state.rules.some((rule) => rule.bindings.some((item) => bindingKey(item) === key))
    },
  }
}
