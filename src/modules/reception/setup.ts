import type { BackendSnapshot, CommandInput } from '@/shared/contracts/backend'
import { normalizeWelcomeSetting, welcomeDelayIssue } from '@/shared/contracts/welcome'

/**
 * 接待设置的复用与统一保存契约。
 *
 * 只处理文字欢迎（含启用状态）和本店转人工关键词/继承状态：平台人工账号、
 * 媒体、平台规则与全局关键词由各自原有入口维护，复用时不得顺带复制或执行。
 */
export interface ReceptionWelcome {
  text: string
  enabled: boolean
  delayMinSeconds?: number
  delayMaxSeconds?: number
}
export interface ReceptionHandoff {
  inherited: boolean
  keywords: string[]
}
export interface ReceptionSetupDraft {
  welcome: ReceptionWelcome
  handoff: ReceptionHandoff
}
export interface ReceptionSetupTarget {
  /** version 是目标店铺保存时的乐观锁，来源版本绝不能带到目标。 */
  welcome: ReceptionWelcome & { version: number }
  handoff: ReceptionHandoff
}
export type ReceptionSetupPart = 'welcome' | 'handoff'
export type ReceptionSnapshot = Pick<BackendSnapshot, 'welcomeByStore' | 'handoffByStore'>

function copyWelcome(value: ReceptionWelcome): ReceptionWelcome {
  const normalized = normalizeWelcomeSetting(value)
  return {
    text: normalized.text,
    enabled: normalized.enabled,
    delayMinSeconds: normalized.delayMinSeconds,
    delayMaxSeconds: normalized.delayMaxSeconds,
  }
}
function copyHandoff(value: ReceptionHandoff): ReceptionHandoff {
  return { inherited: value.inherited, keywords: [...value.keywords] }
}

/** 目标店铺当前接待配置；沿用后端“无记录=继承全局”的既有语义。 */
export function readReceptionSetup(
  snapshot: ReceptionSnapshot,
  storeId: string,
): ReceptionSetupTarget {
  const welcome = snapshot.welcomeByStore[storeId]
  const handoff = snapshot.handoffByStore[storeId]
  return {
    welcome: normalizeWelcomeSetting(welcome),
    handoff: handoff
      ? { inherited: false, keywords: [...handoff.keywords] }
      : {
          inherited: true,
          keywords: [],
        },
  }
}

export interface ReceptionSetupSource {
  draft: ReceptionSetupDraft
  /** 来源未保存的接待项；对应目标值保留不变。 */
  missing: ReceptionSetupPart[]
  hints: string[]
}

/**
 * 只读来源店铺的接待配置，并合并到目标值上。
 * 欢迎语只有存在保存记录才算“已配置”，显式关闭仍会照常复制；转人工的
 * inherited 是有意义的显式状态，不能因为关键词为空而当作缺项。
 */
export function readReceptionSetupSource(
  snapshot: ReceptionSnapshot,
  sourceId: string,
  target: ReceptionSetupTarget,
): ReceptionSetupSource {
  const hasWelcome = Object.hasOwn(snapshot.welcomeByStore, sourceId)
  const source = readReceptionSetup(snapshot, sourceId)
  const missing: ReceptionSetupPart[] = []
  const hints: string[] = []
  if (!hasWelcome) {
    missing.push('welcome')
    hints.push('来源店铺未保存文字欢迎设置，已保留本店欢迎语和启用状态')
  }
  return {
    draft: {
      welcome: copyWelcome(hasWelcome ? source.welcome : target.welcome),
      handoff: copyHandoff(source.handoff),
    },
    missing,
    hints,
  }
}

export interface ReceptionSetupSaveOptions {
  execute(command: CommandInput): Promise<unknown>
  snapshot(): ReceptionSnapshot
  assertCurrent(): void
}
export interface ReceptionSetupSaveReport {
  saved: ReceptionSetupPart[]
  failed: { part: ReceptionSetupPart; message: string }[]
}
export interface ReceptionSetupSaver {
  precheck(storeId: string, expected: ReceptionSetupTarget, parts: ReceptionSetupPart[]): void
  save(
    storeId: string,
    values: ReceptionSetupDraft,
    expected: ReceptionSetupTarget,
    parts: ReceptionSetupPart[],
  ): Promise<ReceptionSetupSaveReport>
  read(storeId: string): ReceptionSetupTarget
}

function failure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
function sameHandoff(left: ReceptionHandoff, right: ReceptionHandoff): boolean {
  return (
    left.inherited === right.inherited &&
    left.keywords.length === right.keywords.length &&
    left.keywords.every((word, index) => word === right.keywords[index])
  )
}
function normalizeKeywords(list: string[]): string[] {
  const result: string[] = []
  for (const raw of list) {
    const word = raw.trim()
    if (!word) continue
    if (word.length > 30) throw Error('本店转人工关键词每个最多30个字符')
    if (!result.includes(word)) result.push(word)
  }
  if (result.length > 100) throw Error('本店转人工关键词最多100个')
  return result
}

/**
 * 接待设置保存适配器。调用方必须先 precheck 再写政策，避免政策写入后才发现
 * 目标接待配置已被其他入口修改；写入后回读，只有真实一致才报告成功。
 */
export function createReceptionSetupSaver(options: ReceptionSetupSaveOptions): ReceptionSetupSaver {
  function read(storeId: string) {
    return readReceptionSetup(options.snapshot(), storeId)
  }
  function precheck(storeId: string, expected: ReceptionSetupTarget, parts: ReceptionSetupPart[]) {
    options.assertCurrent()
    const current = read(storeId)
    for (const part of parts) {
      if (part === 'welcome' && current.welcome.version !== expected.welcome.version)
        throw Error('本店欢迎语已被其他操作更新，请重新载入后再保存')
      if (part === 'handoff' && !sameHandoff(current.handoff, expected.handoff))
        throw Error('本店转人工设置已被其他操作更新，请重新载入后再保存')
    }
  }
  async function savePart(
    storeId: string,
    values: ReceptionSetupDraft,
    expected: ReceptionSetupTarget,
    part: ReceptionSetupPart,
  ) {
    if (part === 'welcome') {
      const text = values.welcome.text.trim()
      if (values.welcome.enabled && !text) throw Error('请先填写文字欢迎语')
      if (text.length > 200) throw Error('文字欢迎语最多200个字符')
      const delay = normalizeWelcomeSetting(values.welcome)
      const invalidDelay = welcomeDelayIssue(
        Object.hasOwn(values.welcome, 'delayMinSeconds')
          ? values.welcome.delayMinSeconds
          : delay.delayMinSeconds,
        Object.hasOwn(values.welcome, 'delayMaxSeconds')
          ? values.welcome.delayMaxSeconds
          : delay.delayMaxSeconds,
      )
      if (invalidDelay) throw Error(invalidDelay)
      await options.execute({
        action: 'save-welcome',
        storeId,
        values: {
          text,
          enabled: values.welcome.enabled,
          version: expected.welcome.version,
          delayMinSeconds: delay.delayMinSeconds,
          delayMaxSeconds: delay.delayMaxSeconds,
        },
      })
      options.assertCurrent()
      const after = options.snapshot().welcomeByStore[storeId]
      if (
        !after ||
        after.text !== text ||
        after.enabled !== values.welcome.enabled ||
        after.version === expected.welcome.version ||
        normalizeWelcomeSetting(after).delayMinSeconds !== delay.delayMinSeconds ||
        normalizeWelcomeSetting(after).delayMaxSeconds !== delay.delayMaxSeconds
      )
        throw Error('欢迎语保存后回读不一致，请重新载入确认')
      return
    }
    const current = read(storeId)
    if (!sameHandoff(current.handoff, expected.handoff))
      throw Error('本店转人工设置已被其他操作更新，请重新载入后再保存')
    const keywords = values.handoff.inherited ? [] : normalizeKeywords(values.handoff.keywords)
    await options.execute({
      action: 'save-store-handoff',
      storeId,
      values: values.handoff.inherited ? { mode: 'inherit' } : { mode: 'custom', keywords },
    })
    options.assertCurrent()
    const after = read(storeId)
    if (!sameHandoff(after.handoff, { inherited: values.handoff.inherited, keywords }))
      throw Error('转人工设置保存后回读不一致，请重新载入确认')
  }
  async function save(
    storeId: string,
    values: ReceptionSetupDraft,
    expected: ReceptionSetupTarget,
    parts: ReceptionSetupPart[],
  ): Promise<ReceptionSetupSaveReport> {
    const report: ReceptionSetupSaveReport = { saved: [], failed: [] }
    for (const part of parts) {
      // 租约失效是整体失败，不能写成某一项的普通失败。
      options.assertCurrent()
      try {
        await savePart(storeId, values, expected, part)
        report.saved.push(part)
      } catch (cause) {
        report.failed.push({ part, message: failure(cause) })
      }
    }
    return report
  }
  return { precheck, save, read }
}
