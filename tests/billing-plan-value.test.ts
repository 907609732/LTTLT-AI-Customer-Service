import { describe, expect, it } from 'vitest'
import {
  callCountText,
  chineseNumeral,
  costPerThousand,
  planValueComparison,
  planValueGain,
  type PlanValue,
} from '../src/modules/billing/plan-value'

const experience: PlanValue = { id: 'usage_1000', amount: 990, calls: 1000 }
const standard: PlanValue = { id: 'usage_10000', amount: 10000, calls: 20000 }
const support: PlanValue = { id: 'support_100000', amount: 100000, calls: 300000 }
const catalog = [experience, standard, support]

describe('套餐额度中文读数', () => {
  it.each([
    [0, '零'],
    [10, '十'],
    [11, '十一'],
    [100, '一百'],
    [1000, '一千'],
    [10000, '一万'],
    [20000, '两万'],
    [100000, '十万'],
    [300000, '三十万'],
    [1000000, '一百万'],
  ] as const)('%i → %s', (value, numeral) => {
    expect(chineseNumeral(value)).toBe(numeral)
  })

  it('中间零只读一个零，并保持分组单位', () => {
    expect(chineseNumeral(1001)).toBe('一千零一')
    expect(chineseNumeral(1010)).toBe('一千零一十')
    expect(chineseNumeral(10001)).toBe('一万零一')
    expect(chineseNumeral(20010)).toBe('两万零一十')
    expect(chineseNumeral(100001)).toBe('十万零一')
    expect(chineseNumeral(101000)).toBe('十万一千')
    expect(chineseNumeral(999999)).toBe('九十九万九千九百九十九')
  })

  it('只有二万读两万，二十万与二十二万仍用二', () => {
    expect(chineseNumeral(200000)).toBe('二十万')
    expect(chineseNumeral(200001)).toBe('二十万零一')
    expect(chineseNumeral(210000)).toBe('二十一万')
    expect(chineseNumeral(220000)).toBe('二十二万')
  })

  it('非法或超范围输入安全退化，不加中文标注', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 100000000])
      expect(chineseNumeral(value)).toBe('')
  })

  it('数字保持服务端原值，只追加括注', () => {
    expect(callCountText(20000)).toBe('20000（两万）次')
    expect(callCountText(300000)).toBe('300000（三十万）次')
    expect(callCountText(12.5)).toBe('12.5 次')
  })
})

describe('套餐每千次费用', () => {
  it('按当前 amount/calls 计算并标注近似值', () => {
    expect(costPerThousand(experience)).toBe('¥9.90')
    expect(costPerThousand(standard)).toBe('¥5.00')
    expect(costPerThousand(support)).toBe('约¥3.33')
  })

  it('额度变化会改变单价，不硬编码旧结果', () => {
    expect(costPerThousand({ amount: 10000, calls: 24000 })).toBe('约¥4.17')
    expect(costPerThousand({ amount: 100000, calls: 100000 })).toBe('¥10.00')
  })

  it('缺失或非法价格/额度不展示费用', () => {
    for (const plan of [
      { amount: 0, calls: 1000 },
      { amount: -1, calls: 1000 },
      { amount: 990, calls: 0 },
      { amount: 990, calls: 1.5 },
      { amount: Number.NaN, calls: 1000 },
    ])
      expect(costPerThousand(plan)).toBe('')
  })
})

describe('套餐同金额额度比较', () => {
  it('标准两档按体验包实际 9.90 动态计算', () => {
    expect(planValueComparison(standard, catalog)).toBe('同等金额，较体验包多 98% 额度')
    expect(planValueComparison(support, catalog)).toBe('同等金额，较体验包多 197% 额度')
  })

  it('使用实际 amount 而非划线原价或硬编码百分比', () => {
    // 若误用 list_amount 10.00 作基准，20000 次只会多 100%。
    expect(planValueComparison(standard, [{ ...experience, amount: 1000 }])).toBe(
      '同等金额，较体验包多 100% 额度',
    )
    expect(planValueComparison({ ...standard, calls: 24000 }, catalog)).toBe(
      '同等金额，较体验包多 137.6% 额度',
    )
    expect(planValueComparison({ ...standard, calls: 24001 }, catalog)).toBe(
      '同等金额，较体验包约多 137.6% 额度',
    )
  })

  it('非整数百分比向下取一位小数，不把约数说成更高', () => {
    // 24006 次的真实增幅约 137.659%，四舍五入会变成 137.7%；展示为约 137.6%。
    expect(planValueComparison({ ...standard, calls: 24006 }, catalog)).toBe(
      '同等金额，较体验包约多 137.6% 额度',
    )
  })

  it('基准缺失、不可比或没有正收益时不编造优惠', () => {
    expect(planValueComparison(experience, catalog)).toBe('')
    expect(planValueComparison(standard, [standard, support])).toBe('')
    expect(planValueComparison(standard, [{ ...experience, calls: 0 }])).toBe('')
    expect(planValueComparison(standard, [{ ...experience, amount: 0 }])).toBe('')
    expect(planValueComparison({ ...standard, calls: 9000 }, catalog)).toBe('')
    expect(planValueComparison({ id: 'other', amount: 990, calls: 1000 }, catalog)).toBe('')
  })
})

describe('套餐增幅结构化展示', () => {
  it('拆分百分比与近似标记，同时保持旧文案不变', () => {
    expect(planValueGain(standard, catalog)).toEqual({ percent: '98', approximate: false })
    expect(planValueGain(support, catalog)).toEqual({ percent: '197', approximate: false })
    expect(planValueComparison(standard, catalog)).toBe('同等金额，较体验包多 98% 额度')
    expect(planValueComparison(support, catalog)).toBe('同等金额，较体验包多 197% 额度')
  })

  it('保留一位小数并在截断时标记约多', () => {
    expect(planValueGain({ ...standard, calls: 24000 }, catalog)).toEqual({
      percent: '137.6',
      approximate: false,
    })
    expect(planValueGain({ ...standard, calls: 24001 }, catalog)).toEqual({
      percent: '137.6',
      approximate: true,
    })
    expect(planValueComparison({ ...standard, calls: 24001 }, catalog)).toBe(
      '同等金额，较体验包约多 137.6% 额度',
    )
  })

  it('体验包、缺少基准或没有正收益时返回空，界面可整块隐藏', () => {
    expect(planValueGain(experience, catalog)).toBeNull()
    expect(planValueGain(standard, [standard, support])).toBeNull()
    expect(planValueGain(standard, [{ ...experience, calls: 0 }])).toBeNull()
    expect(planValueGain(standard, [{ ...experience, amount: 0 }])).toBeNull()
    expect(planValueGain({ ...standard, calls: 9000 }, catalog)).toBeNull()
  })
})
