import { describe, expect, it } from 'vitest'
import {
  chatCandidates,
  documentCandidates,
  productCandidates,
  candidatePack,
} from '../src/modules/knowledge/learning'

describe('knowledge learning candidates', () => {
  it('keeps only same-store adjacent text replies, never candidates or media', () => {
    const messages = [
      { from: 'buyer', content: '多大？', ts: 1 },
      { from: 'seller', content: '十厘米', ts: 2 },
      { from: 'buyer', content: '看看', ts: 3 },
      { from: 'seller', content: 'photo', type: 'image', ts: 4 },
      { from: 'candidate', content: '未发送', ts: 5 },
    ]
    const rows = chatCandidates('shop', [
      { storeId: 'shop', uid: 'buyer', name: '客人', status: '', messages },
      { storeId: 'other', uid: 'buyer', name: '', status: '', messages },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.answer).toBe('十厘米')
    expect(rows[0]?.source).toMatchObject({
      kind: 'chat',
      storeId: 'shop',
      uid: 'buyer',
      questionTs: 1,
      answerTs: 2,
    })
  })
  it('rejects ambiguous documents and preserves explicit Q/A source', () => {
    expect(() => documentCandidates('s', '政策.txt', '随意一段政策')).toThrow()
    const rows = documentCandidates(
      's',
      '政策.txt',
      '问：多久发货\n答：48小时内\n问：包邮吗\n答：以页面为准',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]?.source).toMatchObject({ kind: 'document', label: '政策.txt', line: 1 })
  })
  it('binds products and stores a disabled source audit entry in a disabled new pack', () => {
    const [candidate] = productCandidates('s', [
      {
        id: 'local',
        version: 2,
        updatedAt: 10,
        storeId: 's',
        productId: 'p',
        title: '衣服',
        specifications: 'M | 100',
        description: '',
        price: '',
        enabled: true,
      },
    ])
    const pack = candidatePack(candidate!)
    expect(pack.productIds).toEqual(['p'])
    expect(pack.storeIds).toEqual(['s'])
    expect(pack.enabled).toBe(false)
    expect(pack.entries[1]?.enabled).toBe(false)
    expect(JSON.parse(pack.entries[1]!.answer).source.version).toBe(2)
    expect(() => candidatePack({ ...candidate!, answer: ' ' })).toThrow()
  })
})
