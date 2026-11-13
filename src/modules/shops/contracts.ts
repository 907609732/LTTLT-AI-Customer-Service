/** 演示商品表格的最小展示模型；真实 DTO 在服务层映射到此结构。 */
export interface GoodsRow {
  id: string
  name: string
  code: string
  price: number
}
