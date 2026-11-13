/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface SnapOverlayViewDemo {
  x: {
    x: string
    y: string
    width: number
    items: Array<{ divided: string; active: boolean; detail: string; label: string }>
  }
}
export function createSnapOverlayViewDemo(): SnapOverlayViewDemo {
  return { x: { x: '', y: '', width: 0, items: [] } }
}
