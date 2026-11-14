import {
  managedServiceErrorCodeSchema,
  type ManagedServiceFailure,
  type ManagedServiceErrorCode,
} from '../src/shared/contracts/managed-service-error'

const messages: Record<ManagedServiceErrorCode, string> = {
  service_not_deployed: '当前服务接口未部署，请管理员核对服务版本和代理转发。',
  session_expired: '托管登录已过期，请重新登录。',
  account_disabled: '托管账号已停用，请联系管理员。',
  access_denied: '当前账号没有此操作权限。',
  payment_not_configured: '商户支付尚未配置，当前不能付款。',
  plans_not_configured: '管理员尚未发布充值套餐。',
  invalid_plan: '充值套餐已变化，请刷新后重新选择。',
  billing_conflict: '充值订单发生冲突，请先核对订单及账本，勿重复付款。',
  checkout_unavailable: '支付链接暂不可用，请先核对充值订单。',
  billing_unavailable: '计费服务暂时不可用，请稍后刷新核对。',
  offline: '暂时无法连接托管服务，请检查网络后重试。',
  invalid_response: '托管服务响应不符合当前版本，请管理员核对。',
  team_forbidden: '没有此团队或店铺的操作权限，请核对授权。',
  team_not_found: '团队记录不存在或已不可访问。',
  team_revision_conflict: '团队资料已变化，请刷新后重试。',
  team_invalid_request: '团队操作参数不合法。',
  team_temporarily_unavailable: '团队服务暂时不可用，请刷新核对结果。',
  workspace_changed: '账号或工作区已变化，请重新加载当前页面。',
  canceled: '操作已取消。',
  invalid_request: '业务请求参数无效。',
  request_failed: '托管业务请求未完成，请刷新核对。',
}

/** Only a closed code and integer HTTP status leave the main process; never serialize cause. */
export function toManagedServiceFailure(cause: unknown): ManagedServiceFailure {
  const row = typeof cause === 'object' && cause !== null ? cause : {}
  const rawStatus = 'status' in row ? row.status : null
  const status =
    typeof rawStatus === 'number' &&
    Number.isInteger(rawStatus) &&
    rawStatus >= 100 &&
    rawStatus <= 599
      ? rawStatus
      : null
  const parsed = managedServiceErrorCodeSchema.safeParse('code' in row ? row.code : null)
  const code =
    status === 401
      ? 'session_expired'
      : status === 404 && (!parsed.success || parsed.data === 'request_failed')
        ? 'service_not_deployed'
        : parsed.success
          ? parsed.data
          : 'request_failed'
  return {
    code,
    status,
    message: messages[code],
    retryable: ['offline', 'billing_unavailable', 'team_temporarily_unavailable'].includes(code),
  }
}
