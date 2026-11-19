import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useKnowledgeOnboarding } from '../src/modules/knowledge/onboarding'
import type { KnowledgeJob } from '../src/shared/contracts/knowledge'
type Client = ReturnType<NonNullable<Parameters<typeof useKnowledgeOnboarding>[0]['client']>>
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
})
function fixture() {
  const storeId = ref('shop-a'),
    workspaceId = ref('workspace-a')
  const pipeline = vi.fn(async (input: { action: string }) => {
    if (input.action === 'catalog')
      return {
        identityVersion: 'v1',
        scopeToken: 'scope',
        items: [{ productId: 'p1', title: '商品' }],
        nextCursor: null,
        total: 1,
        complete: true,
        range: '在售',
      }
    if (input.action === 'choose-sources') return { sourceIds: ['source-a'] }
    if (input.action === 'store-materials') return { sourceIds: ['part-a', 'unrelated'] }
    if (input.action === 'preview-import')
      return {
        previewId: 'preview',
        files: 1,
        parts: 1,
        duplicates: 0,
        encodings: [],
        warnings: [],
        rows: [],
      }
    if (input.action === 'estimate')
      return {
        estimateId: 'estimate',
        sources: 1,
        images: 0,
        characters: 8,
        estimatedTokens: 20,
        message: '预计1次调用',
      }
    return { jobId: 'job-a' }
  })
  const job: KnowledgeJob = {
    id: 'job-a',
    storeId: 'shop-a',
    kind: 'import',
    revision: 1,
    status: 'running',
    payload: {},
    checkpoint: { sourceIds: ['part-a'] },
    progress: { completed: 0, total: null },
    error: '',
    createdAt: 1,
    updatedAt: 1,
  }
  const query = vi.fn(async (input: { type: string }) =>
    input.type === 'jobs'
      ? { total: 1, items: [structuredClone(job)], revision: 1 }
      : { total: 0, items: [], revision: 1 },
  )
  const scope = effectScope()
  scopes.push(scope)
  const controller = scope.run(() =>
    useKnowledgeOnboarding({
      storeId,
      workspaceId,
      client: () => ({ pipeline, query }) as unknown as Client,
    }),
  )!
  return { storeId, workspaceId, pipeline, query, job, controller }
}
it('读取在售范围默认选中，按精确预览IDs提交，重复点击不建新任务', async () => {
  const { controller: c, pipeline } = fixture()
  await c.loadCatalog()
  expect(c.selected.value).toEqual(['p1'])
  await Promise.all([c.startImport('collect'), c.startImport('collect')])
  expect(pipeline.mock.calls.filter(([input]) => input.action === 'start')).toHaveLength(1)
  expect(pipeline).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'collect',
      catalog: expect.objectContaining({ productIds: ['p1'], allMatching: false }),
    }),
  )
  expect(c.activeJob.value).toBe(true)
})
it('未知总数不伪造百分比，部分完成不能显示导入成功', async () => {
  const { controller: c, job } = fixture()
  await c.chooseFiles()
  await c.startImport('import')
  await c.refreshJob()
  expect(c.percent.value).toBeNull()
  job.status = 'needs-confirmation'
  job.error = '部分失败'
  job.progress = { completed: 1, total: 2 }
  await c.refreshJob()
  expect(c.percent.value).toBe(50)
  expect(c.imported.value).toBe(false)
  expect(c.notice.value).toContain('待确认')
})
it('文件必须预览确认，导入后不自动学习，学习只用本次资料且须再次确认', async () => {
  const { controller: c, pipeline, job } = fixture()
  await c.chooseFiles()
  expect(pipeline.mock.calls.some(([input]) => input.action === 'start')).toBe(false)
  await c.startImport('import')
  job.status = 'succeeded'
  job.progress = { completed: 1, total: 1 }
  await c.refreshJob()
  expect(c.imported.value).toBe(true)
  await c.estimateLearning()
  expect(c.estimate.value?.message).toBe('预计1次调用')
  expect(pipeline.mock.calls.filter(([input]) => input.action === 'start')).toHaveLength(1)
  await c.startLearning()
  expect(pipeline).toHaveBeenLastCalledWith({
    action: 'start',
    kind: 'learn',
    storeId: 'shop-a',
    sourceIds: ['part-a'],
    bindingIds: [],
    estimateId: 'estimate',
  })
})
it('切账号后丢弃迟到目录，不提交旧店任务', async () => {
  const { controller: c, pipeline, workspaceId } = fixture()
  let finish!: (value: unknown) => void
  pipeline.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve as (value: unknown) => void
      }),
  )
  const pending = c.loadCatalog()
  workspaceId.value = 'workspace-b'
  finish({ identityVersion: 'old', scopeToken: 'old', items: [], nextCursor: null })
  await pending
  expect(c.catalog.value).toBeUndefined()
  expect(c.error.value).toBe('')
  expect(c.jobId.value).toBe('')
})
it('请求失败显示错误而非成功，不自动重复提交', async () => {
  const { controller: c, pipeline } = fixture()
  pipeline.mockRejectedValueOnce(
    Error("Error invoking remote method 'knowledge:request': Error: 额度不足"),
  )
  await c.chooseFiles()
  expect(c.error.value).toBe('额度不足')
  expect(c.imported.value).toBe(false)
  expect(pipeline).toHaveBeenCalledTimes(1)
})
it('提交结果未知时锁定再次发起，防止重复学习或导入', async () => {
  const { controller: c, pipeline } = fixture()
  await c.chooseFiles()
  pipeline.mockRejectedValueOnce(Error('连接中断'))
  await c.startImport('import')
  expect(c.submissionUnknown.value).toBe(true)
  const calls = pipeline.mock.calls.length
  await c.startImport('import')
  expect(pipeline.mock.calls).toHaveLength(calls)
})
it('没有有效任务编号不能伪造已提交或解除重复提交保护', async () => {
  const { controller: c, pipeline } = fixture()
  await c.chooseFiles()
  pipeline.mockResolvedValueOnce({ jobId: '' })
  await c.startImport('import')
  expect(c.jobId.value).toBe('')
  expect(c.submissionUnknown.value).toBe(true)
  expect(c.error.value).toContain('未收到任务编号')
})
