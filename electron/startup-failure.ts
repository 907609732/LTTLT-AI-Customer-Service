import { KnowledgeRestoreInterruptedError } from './knowledge/restore-intent'

/** Only our typed recovery error may expose a trusted local directory in the startup dialog. */
export function reportStartupFailure(
  error: unknown,
  ports: {
    showErrorBox(title: string, message: string): void
    exit(code: number): void
  },
) {
  if (error instanceof KnowledgeRestoreInterruptedError) {
    ports.showErrorBox(
      '知识库恢复中断 · 已停止启动',
      `检测到尚未完成的知识库替换，已停止启动，未创建空库或重新导入旧资料。\n\n恢复材料位于当前账号目录：\n${error.directory}\n\n请保持应用关闭，先完整复制该目录（包括 knowledge-restore-intent.json、knowledge-pre-restore-*、knowledge-restore-* 和现存 knowledge.sqlite/WAL/SHM），将副本交给维护人员按 docs/KNOWLEDGE_LIBRARY.md“恢复中断维护步骤”核对恢复。\n不要删除标记或恢复材料后直接重启；确认完整备份恢复前不要改动原目录。`,
    )
  } else {
    ports.showErrorBox(
      '本地服务启动失败',
      '本地配置或界面未能加载。请保留原数据，查看启动终端或日志后排查；不要删除数据后重试。',
    )
  }
  ports.exit(1)
}
