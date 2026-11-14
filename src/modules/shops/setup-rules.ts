import { z } from 'zod'
import { profilesSchema, profileSchema, type CommandInput } from '@/shared/contracts/backend'

const text = z.string().max(2000)
const draftSchema = z
  .object({
    style: z.enum([
      'soft',
      'cute',
      'practical',
      'professional',
      'warm',
      'cool',
      'humorous',
      'gentle',
    ]),
    length: z.enum(['short', 'balanced', 'detailed']),
    origins: z.array(z.string().min(1).max(200)).max(30),
    carriers: z.array(z.string().min(1).max(200)).max(30),
    designatedCourier: z.boolean().nullable(),
    dispatchTime: text,
    cutoffTime: text,
    shippingNotes: text,
    freightInsurance: z.boolean().nullable(),
    insuranceExcessPayer: z.enum(['', 'merchant', 'buyer', 'negotiate']),
    insuranceNotes: text,
    exchangeSupported: z.boolean().nullable(),
    exchangePolicy: text,
    returnSupported: z.boolean().nullable(),
    returnPolicy: text,
    cashbackSupported: z.boolean().nullable(),
    cashbackAmount: z.string().max(30),
    cashbackProcess: text,
    compensationSupported: z.boolean().nullable(),
    compensationLimit: z.string().max(30),
    compensationPolicy: text,
    warrantyPolicy: text,
  })
  .strict()

export type SetupDraft = z.infer<typeof draftSchema>
type Profiles = z.infer<typeof profilesSchema>
export function createBlankSetupDraft(): SetupDraft {
  return {
    style: 'practical',
    length: 'balanced',
    origins: [],
    carriers: [],
    designatedCourier: null,
    dispatchTime: '',
    cutoffTime: '',
    shippingNotes: '',
    freightInsurance: null,
    insuranceExcessPayer: '',
    insuranceNotes: '',
    exchangeSupported: true,
    exchangePolicy: '协商：没拆封，没使用痕迹，不影响二次销售的情况下支持换货呢',
    returnSupported: true,
    returnPolicy: '没拆封，没使用痕迹，不影响二次销售的情况下支持退货退款呢',
    cashbackSupported: true,
    cashbackAmount: '1',
    cashbackProcess: '带图好评后截图',
    compensationSupported: true,
    compensationLimit: '1',
    compensationPolicy: '仅限商品破损，质量问题给予小额补偿',
    warrantyPolicy: '',
  }
}

const start = '<!-- lingtu-shop-setup:v1 -->'
const end = '<!-- /lingtu-shop-setup:v1 -->'
const instruction =
  '以下是本店商家确认的客服设置；空值和null表示未知，不得推断商业承诺。style风格：soft柔和、cute可爱、practical务实、professional专业、warm热情、cool简洁克制、humorous幽默、gentle温柔。length详略：short简短、balanced适中、detailed充分；不改变既有回复字数上限。返现和补偿仅说明政策，不代表已付款或已批准操作，禁止自动支付。\n'
const blockSchema = z
  .object({ version: z.literal(1), storeId: z.string().min(1).max(64), draft: draftSchema })
  .strict()

function readBlock(prompt: string): { base: string; block: z.infer<typeof blockSchema> | null } {
  const begin = prompt.indexOf(start)
  if (begin < 0) {
    if (prompt.includes(end)) throw Error('店铺向导规则格式损坏，请在模型规则中核对后重试')
    return { base: prompt, block: null }
  }
  const finish = prompt.indexOf(end, begin + start.length)
  if (
    finish < 0 ||
    prompt.indexOf(start, begin + start.length) >= 0 ||
    prompt.indexOf(end, finish + end.length) >= 0
  ) {
    throw Error('店铺向导规则格式损坏，请在模型规则中核对后重试')
  }
  const content = prompt.slice(begin + start.length, finish).trim()
  if (!content.startsWith(instruction.trim())) throw Error('店铺向导规则格式损坏')
  let value: unknown
  try {
    value = JSON.parse(content.slice(instruction.trim().length).trim())
  } catch {
    throw Error('店铺向导规则格式损坏')
  }
  const parsed = blockSchema.safeParse(value)
  if (!parsed.success) throw Error('店铺向导规则格式损坏，请重新核对设置')
  return { base: prompt.slice(0, begin) + prompt.slice(finish + end.length), block: parsed.data }
}

function effective(state: Profiles, storeId: string) {
  const profileId = state.bindings[storeId]
  const profile = state.profiles.find((item) => item.id === profileId)
  if (profileId && !profile) throw Error('本店模型规则绑定无效，请重新载入')
  return profile ?? { prompt: state.globalPrompt, maxReplyChars: state.globalMaxReplyChars }
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}
function conflict(): never {
  throw Error('模型规则或店铺绑定已更新，无法确认本次保存，请重新载入后核对')
}

/** 每次打开向导创建实例。调用方的租约必须同时约束workspace和store，不能只检查界面是否可见。 */
export function createSetupRules(options: {
  execute(command: CommandInput): Promise<{ data?: unknown }>
  assertCurrent(): void
}) {
  let loaded: { storeId: string; state: Profiles } | null = null
  let saving = false
  let generation = 0
  async function request(command: CommandInput) {
    options.assertCurrent()
    const result = await options.execute(command)
    options.assertCurrent()
    return result.data
  }
  async function list() {
    const state = profilesSchema.parse(await request({ action: 'list-model-profiles' }))
    if (
      !Number.isInteger(state.revision) ||
      state.revision < 0 ||
      new Set(state.profiles.map((p) => p.id)).size !== state.profiles.length
    )
      throw Error('模型规则响应无效')
    return state
  }
  async function load(storeId: string): Promise<SetupDraft> {
    if (saving) throw Error('设置正在保存，请稍候')
    z.string().min(1).max(64).parse(storeId)
    const token = ++generation
    loaded = null
    const state = await list()
    if (token !== generation) throw Error('设置载入已过期')
    const { block } = readBlock(effective(state, storeId).prompt)
    loaded = { storeId, state }
    return block?.storeId === storeId ? structuredClone(block.draft) : createBlankSetupDraft()
  }
  async function save(storeId: string, input: SetupDraft): Promise<void> {
    options.assertCurrent()
    if (saving) throw Error('设置正在保存，请勿重复提交')
    if (!loaded || loaded.storeId !== storeId) throw Error('请先载入当前店铺设置')
    const baseline = loaded.state
    const draft = draftSchema.parse(input)
    if (
      !draft.origins.some((v) => v.trim()) ||
      !draft.carriers.some((v) => v.trim()) ||
      draft.designatedCourier === null
    )
      throw Error('请明确发货地、物流快递与指定快递政策')
    if (!draft.dispatchTime.trim() || draft.freightInsurance === null)
      throw Error('请明确发货时效与是否提供运费险')
    if (draft.freightInsurance === true && !draft.insuranceExcessPayer)
      throw Error('请选择超出运费险部分的承担方')
    if (
      draft.exchangeSupported === null ||
      draft.returnSupported === null ||
      draft.cashbackSupported === null ||
      draft.compensationSupported === null
    )
      throw Error('请明确全部售后政策')
    if (draft.exchangeSupported && !draft.exchangePolicy.trim()) throw Error('请填写换货说明')
    if (draft.returnSupported && !draft.returnPolicy.trim()) throw Error('请填写退货说明')
    if (draft.cashbackSupported && !draft.cashbackProcess.trim()) throw Error('请填写返现流程')
    if (
      draft.compensationSupported &&
      (!draft.compensationLimit.trim() || !draft.compensationPolicy.trim())
    )
      throw Error('请填写补偿限额与说明')
    if (draft.freightInsurance !== true) {
      draft.insuranceExcessPayer = ''
      draft.insuranceNotes = ''
    }
    if (draft.exchangeSupported !== true) draft.exchangePolicy = ''
    if (draft.returnSupported !== true) draft.returnPolicy = ''
    if (draft.cashbackSupported !== true) {
      draft.cashbackAmount = ''
      draft.cashbackProcess = ''
    } else if (
      !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(draft.cashbackAmount) ||
      Number(draft.cashbackAmount) <= 0
    ) {
      throw Error('返现金额必须为正数，最多两位小数')
    }
    if (draft.compensationSupported !== true) {
      draft.compensationLimit = ''
      draft.compensationPolicy = ''
    } else if (
      draft.compensationLimit &&
      !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(draft.compensationLimit)
    ) {
      throw Error('补偿限额必须为非负金额，最多两位小数')
    }
    const source = effective(baseline, storeId)
    const original = readBlock(source.prompt)
    // 一个方案只保留一个受本适配器管理的区块；不能误删未知店铺的政策。
    if (original.block && original.block.storeId !== storeId)
      throw Error('当前方案包含其他店铺向导政策，请先核对本店模型规则')
    const payload = JSON.stringify({ version: 1, storeId, draft }).replaceAll('<', '\\u003c')
    const prompt = `${original.base.trimEnd()}\n\n${start}\n${instruction}${payload}\n${end}`.trim()
    if (prompt.length > 8000) throw Error('现有模型规则与向导设置合计超过8000字符，请精简后重试')
    saving = true
    try {
      const current = await list()
      if (!same(current, baseline)) conflict()
      // 克隆使共享方案与全局规则完全不动。中途失败最多留下未绑定方案，绝不强行覆盖绑定。
      const saved = profileSchema.parse(
        await request({
          action: 'save-model-profile',
          values: {
            name: `店铺助手-${storeId}`.slice(0, 100),
            prompt,
            maxReplyChars: source.maxReplyChars,
          },
        }),
      )
      const afterSave = await list()
      if (
        saved.prompt !== prompt ||
        saved.maxReplyChars !== source.maxReplyChars ||
        baseline.profiles.some((p) => p.id === saved.id)
      )
        conflict()
      if (
        !same(afterSave, {
          ...baseline,
          revision: baseline.revision + 1,
          profiles: [...baseline.profiles, saved],
        })
      )
        conflict()
      await request({
        action: 'bind-model-profile',
        storeId,
        values: { profileId: saved.id, revision: afterSave.revision },
      })
      const confirmed = await list()
      if (
        !same(confirmed, {
          ...afterSave,
          revision: afterSave.revision + 1,
          bindings: { ...baseline.bindings, [storeId]: saved.id },
        })
      )
        conflict()
      loaded = { storeId, state: confirmed }
    } finally {
      saving = false
    }
  }
  return { load, save }
}
