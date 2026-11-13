/**
 * 本机模拟店铺的公共契约。
 *
 * 主进程（模拟顾客服务、适配器）、渲染层客服台与浏览器里的“模拟顾客页”共用这一组字段，
 * 避免三处各自解释同一批数据。这里只有本机模拟，不代表任何真实平台店铺、真实买家或真实登录态：
 * - 平台 id 是项目自有的 `sim-local`，由主进程在创建后端时显式注入，拼多多/抖店等真实平台不受影响；
 * - 消息、买家身份都保存在本机，删除店铺或清空模拟数据后即消失；
 * - 任何“已发送”只表示本机模拟页收到，不承诺真实平台送达。
 */
export const SIM_PLATFORM_ID = 'sim-local'
export const SIM_PLATFORM_LABEL = '本机模拟店铺'

/** 模拟顾客：uid 由主进程生成，name 是顾客在模拟页里设置的名字。 */
export interface SimPersona {
  uid: string
  name: string
  /** 顾客自述备注（如“问尺码”），仅用于本机演示，不进入 AI 上下文以外的业务判断。 */
  note: string
  createdAt: number
}

/** 模拟会话中的一条消息；from 只有买家和客服两种，与真实采集格式一致。 */
export interface SimMessage {
  msgId: string
  from: 'buyer' | 'seller'
  content: string
  ts: number
}

/** 主进程推给渲染层的模拟服务状态；未启动时 running=false 且 error 为明确原因。 */
export interface SimulatorStatus {
  running: boolean
  port: number
  /** 顾客模拟页地址（含本次运行的随机口令）；未启动时为空字符串。 */
  url: string
  error: string
}

/** 模拟顾客页可用的动作结果；失败必须带人可读原因，不伪装成功。 */
export interface SimulatorActionResult {
  ok: boolean
  message: string
}
