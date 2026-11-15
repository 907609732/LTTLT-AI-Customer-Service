export const entryStatusLabel = (value: string) =>
  (
    ({ draft: '待审核', approved: '已审核', withdrawn: '已撤回', stale: '来源已变更' }) as Record<
      string,
      string
    >
  )[value] || value
export const scopeLabel = (value: string) =>
  (
    ({
      canonical: '共享商品',
      binding: '本店商品/SKU覆盖',
      template: '公共模板',
      store: '本店问答',
    }) as Record<string, string>
  )[value] || value
export const fieldLabel = (value: string) =>
  (
    ({ fact: '静态事实', price: '价格', stock: '库存', activity: '活动' }) as Record<string, string>
  )[value] || value
export const sourceLabel = (value: string) =>
  (
    ({
      manual: '手工资料',
      platform: '平台采集',
      document: '文档',
      image: '图片',
      chat: '已有聊天',
      'legacy-audit': '旧来源审计',
    }) as Record<string, string>
  )[value] || value
export const productStatusLabel = (value: string) =>
  (
    ({
      matched: '已匹配',
      unknown: '未核实',
      ambiguous: '身份不唯一',
      unspecified: '未指定商品',
    }) as Record<string, string>
  )[value] || value
export const jobStatusLabel = (value: string) =>
  (
    ({
      queued: '排队中',
      running: '进行中',
      paused: '已暂停',
      'needs-confirmation': '待人工确认',
      succeeded: '已完成',
      failed: '失败',
      cancelled: '已取消',
    }) as Record<string, string>
  )[value] || value
export const jobKindLabel = (value: string) =>
  (
    ({ collect: '采集', learn: '学习', import: '导入', 'daily-check': '每日检查' }) as Record<
      string,
      string
    >
  )[value] || value
