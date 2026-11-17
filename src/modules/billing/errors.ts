/** Only stable codes cross the service boundary; raw IPC/network messages can contain internals. */
export function billingErrorMessage(cause: unknown): string {
  const row = typeof cause === 'object' && cause !== null ? cause : {}
  const code = 'code' in row && typeof row.code === 'string' ? row.code : ''
  const status = 'status' in row ? row.status : null
  if (status === 404 || code === 'service_not_deployed')
    return '当前服务的计费接口未部署，或代理未转发此路由。请管理员核对服务版本后重试。'
  if (status === 401 || ['session_expired', 'unauthorized', 'invalid_grant'].includes(code))
    return '托管登录已过期，请返回配置中心重新登录。'
  if (code === 'payment_not_configured') return '商户支付尚未配置，当前不能付款。请联系管理员。'
  if (code === 'plans_not_configured') return '管理员尚未发布充值套餐，当前不能创建充值订单。'
  if (status === 409 || code === 'billing_conflict')
    return '充值订单与本次操作冲突，请先刷新充值订单和账本核对，勿重复付款。'
  if (code === 'invalid_plan') return '充值套餐已变化，请刷新套餐后重新选择。'
  if (code === 'invalid_channel') return '所选支付渠道当前不可用，请刷新套餐后重新选择。'
  if (code === 'request_uncertain' || code === 'request_pending')
    return '上次支付请求结果尚未确认，请用原套餐和渠道重试查询，勿重复付款。'
  if (code === 'payment_reconciliation_required')
    return '支付结果尚未由渠道确认，请稍后刷新核对订单；不要重复付款。'
  if (code === 'order_not_found') return '未找到这笔充值订单，请刷新订单列表后重试。'
  if (code === 'checkout_unavailable') return '支付链接暂不可用，请先核对充值订单，勿重复付款。'
  if (code === 'account_disabled' || status === 403) return '当前账号没有计费权限，请联系管理员。'
  if (code === 'offline' || code === 'network_unavailable')
    return '暂时无法连接托管服务，请检查网络后重试。'
  if (code === 'invalid_response') return '计费服务响应不符合当前版本，请管理员核对服务版本。'
  if (code === 'billing_unavailable' || (typeof status === 'number' && status >= 500))
    return '计费服务暂时不可用，请稍后刷新核对。'
  return '本次计费请求未完成，请刷新核对；需要时联系管理员检查服务。'
}
