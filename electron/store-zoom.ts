/** Uses only the registered adapter's native page; no arbitrary renderer target is accepted. */
export function applyStoreZoom(adapter: unknown, percent: number): number {
  if (!Number.isInteger(percent) || percent < 75 || percent > 200)
    throw Error('缩放范围为75%至200%')
  if (!adapter || typeof adapter !== 'object') throw Error('请先打开店铺页面')
  const getPage = Reflect.get(adapter, '_wc')
  if (typeof getPage !== 'function') throw Error('此平台不支持网页缩放')
  const page: unknown = getPage.call(adapter)
  if (!page || typeof page !== 'object') throw Error('店铺页面尚未就绪')
  const destroyed = Reflect.get(page, 'isDestroyed'),
    set = Reflect.get(page, 'setZoomFactor'),
    get = Reflect.get(page, 'getZoomFactor')
  if (
    typeof destroyed !== 'function' ||
    destroyed.call(page) ||
    typeof set !== 'function' ||
    typeof get !== 'function'
  )
    throw Error('店铺页面不可缩放')
  set.call(page, percent / 100)
  return Math.round(Number(get.call(page)) * 100)
}
