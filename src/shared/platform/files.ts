/** 文本导出通过浏览器下载能力完成，不向组件开放文件系统路径或任意文件写入。 */
export function downloadText(
  name: string,
  content: string,
  mime = 'application/json;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
