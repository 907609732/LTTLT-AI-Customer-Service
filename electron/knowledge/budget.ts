import { Worker } from 'node:worker_threads'
import { countContextTokens, type ModelMessages } from '../context-compression'
import { knowledgeRequire } from './node-loader'
/** Tokenization can be quadratic for unusual text. Keep the existing codec and exact policy,
 * but isolate CPU work so cancellation, window repaint and account shutdown remain responsive. */
export function estimateKnowledgeTokens(
  messages: ModelMessages,
  signal?: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error('知识任务已取消'))
      return
    }
    const worker = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads');
      const {Tiktoken}=require(workerData.codec); const rank=require(workerData.rank);
      const encoder=new Tiktoken(rank); const count=${countContextTokens.toString()};
      parentPort.postMessage(count(workerData.messages, text=>encoder.encode(text,[],[]).length));`,
      {
        eval: true,
        workerData: {
          messages,
          codec: knowledgeRequire.resolve('js-tiktoken/lite'),
          rank: knowledgeRequire.resolve('js-tiktoken/ranks/cl100k_base'),
        },
      },
    )
    let done = false
    const finish = (error?: Error, value?: number) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(error)
      else resolve(value!)
    }
    const abort = () => finish(Error('知识任务已取消'))
    const timer = setTimeout(
      () => finish(Error('资料预算计算超时，请缩小资料范围；未调用模型')),
      60000,
    )
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value)
        ? finish(undefined, value)
        : finish(Error('预算计量失败')),
    )
    worker.once('error', (error) => finish(error))
    worker.once('exit', (code) => {
      if (!done) finish(Error(`预算计量进程退出：${code}`))
    })
  })
}
