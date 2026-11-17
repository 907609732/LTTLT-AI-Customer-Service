/** 由 Electron 主进程查询用户配置的模型目录；API Key 不进入渲染层之外的其他状态。 */
export async function listCustomModels(
  values: Record<string, unknown>,
  request: typeof fetch = fetch,
): Promise<string[]> {
  const baseUrl =
    typeof values.baseUrl === 'string' ? values.baseUrl.trim().replace(/\/+$/, '') : ''
  const apiKey = typeof values.apiKey === 'string' ? values.apiKey.trim() : ''
  if (!baseUrl) throw new Error('请填写 API 地址')
  if (!apiKey) throw new Error('请先填写 API Key')

  let endpoint: URL
  try {
    endpoint = new URL(baseUrl)
  } catch {
    throw new Error('API 地址格式无效，请填写完整的 http(s) 地址')
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    throw new Error('API 地址必须是无内嵌凭证的 http(s) 地址')

  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/models`
  endpoint.search = ''
  endpoint.hash = ''
  let response: Response
  try {
    response = await request(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new Error('获取模型列表失败，请检查 API 地址、网络或服务状态')
  }
  if (!response.ok) throw new Error(`获取模型列表失败（HTTP ${response.status}）`)

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('模型列表响应不是有效 JSON')
  }
  if (!body || typeof body !== 'object') throw new Error('模型列表响应格式无效')
  const record = body as { data?: unknown; models?: unknown }
  const rows = Array.isArray(record.data) ? record.data : record.models
  if (!Array.isArray(rows)) throw new Error('响应中未找到模型列表')
  const models = rows
    .map((row) => (row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    .map((id) => id.trim())
  return [...new Set(models)].slice(0, 5000)
}
