import type { KnowledgeJob } from './contracts/knowledge'

/** Work needing user recovery must not be hidden behind terminal history. */
export function isRecoverableKnowledgeJob(job: Pick<KnowledgeJob, 'status' | 'progress'>) {
  return (
    ['queued', 'running', 'paused', 'needs-confirmation'].includes(job.status) ||
    (job.status === 'failed' &&
      (job.progress.total === null || job.progress.completed < job.progress.total))
  )
}
