import { ref } from 'vue'

/** 表单操作保留草稿和错误；同一按钮执行期间不允许重复提交。 */
export function useTask() {
  const pending = ref(false),
    error = ref(''),
    message = ref('')
  async function run(job: () => Promise<void>): Promise<boolean> {
    if (pending.value) return false
    pending.value = true
    error.value = ''
    message.value = ''
    try {
      await job()
      return true
    } catch (cause) {
      error.value = (cause instanceof Error ? cause.message : String(cause)).replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        '',
      )
      return false
    } finally {
      pending.value = false
    }
  }
  return { pending, error, message, run }
}
