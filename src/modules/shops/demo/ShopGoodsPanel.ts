import type { GoodsRow } from '../contracts'
/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopGoodsPanelDemo {
  template: string
  isLoading: boolean
  shopName: string
  shops: Array<{ id: number; name: string }>
  loadError: string
  learnJobs: string
  learnedCounts: string
  isLoadingPreview: boolean
  rows: { rows: GoodsRow[]; total: number; page: number }
  pageSize: string
  nameQuery: string
  codeQuery: string
  allPageSelected: boolean
  isSelected: string
  shop: { id: number }
  mod: string
  goods: Array<{
    id: string
    name: string
    price: string
    sales: string
    learning: boolean
    learned: string
  }>
  goodsSearch: string
  isQty: string
  qtyOptions: Array<string>
  cost: string
  costPerItem: string
  syncing: string
  goodsPreview: {
    id: number
    name: string
    code: string
    price: string
    sku: string
    sales: string
    learning: string
    learned: string
    specs: string
    detail: string
    goodsConfig: string
  }
  isDetail: string
  batchCount: { length: number }
  name: string
}
export function createShopGoodsPanelDemo(): ShopGoodsPanelDemo {
  return {
    template: '',
    isLoading: false,
    shopName: '',
    shops: [],
    loadError: '',
    learnJobs: '',
    learnedCounts: '',
    isLoadingPreview: false,
    rows: { rows: [], total: 0, page: 1 },
    pageSize: '',
    nameQuery: '',
    codeQuery: '',
    allPageSelected: false,
    isSelected: '',
    shop: { id: 0 },
    mod: '',
    goods: [],
    goodsSearch: '',
    isQty: '',
    qtyOptions: [],
    cost: '',
    costPerItem: '',
    syncing: '',
    goodsPreview: {
      id: 1,
      name: '',
      code: '',
      price: '',
      sku: '',
      sales: '',
      learning: '',
      learned: '',
      specs: '',
      detail: '',
      goodsConfig: '',
    },
    isDetail: '',
    batchCount: { length: 0 },
    name: '',
  }
}
