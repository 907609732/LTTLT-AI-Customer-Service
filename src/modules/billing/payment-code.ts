/**
 * 扫码收银台的二维码只在本机把渠道返回的文本转成 data URL：
 * 不上传买家/订单资料到第三方二维码服务，也不打开二维码里的支付串。
 * 懒加载让缺少可选依赖时收银台仍能查询订单，而不是整页渲染失败。
 */
export async function paymentCodeImage(text: string): Promise<string> {
  const module = await import('qrcode')
  return module.default.toDataURL(text, { width: 240, margin: 2 })
}
