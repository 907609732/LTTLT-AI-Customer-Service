import { describe, expect, it } from 'vitest'
import { createBlankSetupDraft, type SetupDraft } from '../src/modules/shops/setup-rules'
import {
  defaultReuseSelection,
  draftHasContent,
  mergePolicyReuse,
  reuseSectionNames,
  reuseSections,
  selectedReuseSections,
} from '../src/modules/shops/setup-reuse'

function targetDraft(): SetupDraft {
  return Object.assign(createBlankSetupDraft(), {
    style: 'gentle',
    length: 'balanced',
    customPrompt: '本店要求先确认型号',
    maxReplyChars: 180,
    origins: ['浙江'],
    carriers: [],
    designatedCourier: null,
    dispatchTime: '24小时内',
    cutoffTime: '',
    shippingNotes: '',
    freightInsurance: null,
    insuranceExcessPayer: '',
    exchangeSupported: true,
    exchangePolicy: '本店换货说明',
    returnSupported: true,
    returnPolicy: '本店退货说明',
    cashbackSupported: true,
    cashbackAmount: '2',
    cashbackProcess: '本店返现流程',
    compensationSupported: true,
    compensationLimit: '3',
    compensationPolicy: '本店补偿说明',
    warrantyPolicy: '本店保修',
  })
}

function sourceDraft(): SetupDraft {
  return Object.assign(createBlankSetupDraft(), {
    style: 'cool',
    length: 'short',
    customPrompt: '',
    maxReplyChars: 321,
    origins: [],
    carriers: ['顺丰速运'],
    designatedCourier: false,
    dispatchTime: '',
    cutoffTime: '18点',
    shippingNotes: '',
    freightInsurance: true,
    insuranceExcessPayer: 'buyer',
    insuranceNotes: '来源运费险说明',
    exchangeSupported: false,
    exchangePolicy: '',
    returnSupported: true,
    returnPolicy: '来源退货条件',
    cashbackSupported: false,
    cashbackAmount: '',
    cashbackProcess: '',
    compensationSupported: false,
    compensationLimit: '',
    compensationPolicy: '',
    warrantyPolicy: '来源保修条款',
  })
}

describe('复用其他店铺配置的四类选择', () => {
  it('四类默认全选，名称与顺序稳定，可按类别裁剪', () => {
    expect(reuseSections).toEqual(['style', 'logistics', 'reception', 'afterSales'])
    expect(reuseSectionNames).toEqual({
      style: '客服风格',
      logistics: '物流与发货政策',
      reception: '接待设置',
      afterSales: '售后政策',
    })
    const selection = defaultReuseSelection()
    expect(selection).toEqual({ style: true, logistics: true, reception: true, afterSales: true })
    selection.reception = false
    expect(selectedReuseSections(selection)).toEqual(['style', 'logistics', 'afterSales'])
    expect(selectedReuseSections(defaultReuseSelection())).toEqual([
      'style',
      'logistics',
      'reception',
      'afterSales',
    ])
  })

  it('源店铺已配置时复制四类策略字段，并保留源端空缺项的目标值', () => {
    const target = targetDraft()
    const source = sourceDraft()
    const result = mergePolicyReuse({
      target,
      source,
      sourceConfigured: true,
      selection: defaultReuseSelection(),
    })
    expect(result.draft).toMatchObject({
      style: 'cool',
      length: 'short',
      customPrompt: '本店要求先确认型号',
      maxReplyChars: 321,
      origins: ['浙江'],
      carriers: ['顺丰速运'],
      designatedCourier: false,
      dispatchTime: '24小时内',
      cutoffTime: '18点',
      shippingNotes: '',
      freightInsurance: true,
      insuranceExcessPayer: 'buyer',
      insuranceNotes: '来源运费险说明',
      exchangeSupported: false,
      returnSupported: true,
      returnPolicy: '来源退货条件',
      cashbackSupported: false,
      compensationSupported: false,
      warrantyPolicy: '来源保修条款',
    })
    // 显式 false 必须覆盖目标值，不能被当作“未配置”。
    expect(result.draft.exchangeSupported).toBe(false)
    expect(result.draft.designatedCourier).toBe(false)
    // 源端为空的必填项保留本店填写，并给出可读提示。
    expect(result.hints.join('；')).toContain('发货地')
    expect(result.hints.join('；')).toContain('发货时效')
    expect(result.hints.join('；')).toContain('客服回复要求')
    expect(result.hints.join('；')).toContain('已保留本店内容')
    expect(result.missing).toEqual([])
  })

  it('只应用勾选类别，未勾选类别的目标值完全不变', () => {
    const target = targetDraft()
    const source = sourceDraft()
    const selection = defaultReuseSelection()
    selection.style = false
    selection.logistics = false
    selection.afterSales = false
    const onlyReception = mergePolicyReuse({ target, source, sourceConfigured: true, selection })
    expect(onlyReception.draft).toEqual(target)
    expect(onlyReception.hints).toEqual([])

    selection.afterSales = true
    const afterSales = mergePolicyReuse({ target, source, sourceConfigured: true, selection })
    expect(afterSales.draft).toMatchObject({
      style: 'gentle',
      origins: ['浙江'],
      exchangeSupported: false,
      returnPolicy: '来源退货条件',
      warrantyPolicy: '来源保修条款',
    })
    expect(afterSales.draft).toEqual({
      ...target,
      exchangeSupported: false,
      exchangePolicy: '',
      returnSupported: true,
      returnPolicy: '来源退货条件',
      cashbackSupported: false,
      cashbackAmount: '',
      cashbackProcess: '',
      compensationSupported: false,
      compensationLimit: '',
      compensationPolicy: '',
      warrantyPolicy: '来源保修条款',
    })
  })

  it('来源店铺未配置向导策略时整类保留目标值并明确提示', () => {
    const target = targetDraft()
    const result = mergePolicyReuse({
      target,
      source: createBlankSetupDraft(),
      sourceConfigured: false,
      selection: defaultReuseSelection(),
    })
    expect(result.draft).toEqual(target)
    expect(result.missing).toEqual(['style', 'logistics', 'afterSales'])
    expect(result.hints).toHaveLength(1)
    expect(result.hints[0]).toContain('未配置')
    expect(result.hints[0]).toContain('客服风格')
    expect(result.hints[0]).toContain('售后政策')
  })

  it('合并结果与来源、目标数组互不共享，重复导入不累积', () => {
    const target = targetDraft()
    const source = sourceDraft()
    const first = mergePolicyReuse({
      target,
      source,
      sourceConfigured: true,
      selection: defaultReuseSelection(),
    })
    first.draft.origins.push('江苏')
    first.draft.carriers.push('中通快递')
    expect(target.origins).toEqual(['浙江'])
    expect(source.carriers).toEqual(['顺丰速运'])
    const second = mergePolicyReuse({
      target,
      source,
      sourceConfigured: true,
      selection: defaultReuseSelection(),
    })
    expect(second.draft.origins).toEqual(['浙江'])
    expect(second.draft.carriers).toEqual(['顺丰速运'])
  })

  it('识别已有草稿内容，空草稿不需要替换确认', () => {
    expect(draftHasContent(createBlankSetupDraft())).toBe(false)
    const draft = createBlankSetupDraft()
    draft.origins = ['浙江']
    expect(draftHasContent(draft)).toBe(true)
    const explicitFalse = createBlankSetupDraft()
    explicitFalse.designatedCourier = false
    expect(draftHasContent(explicitFalse)).toBe(true)
  })
})
