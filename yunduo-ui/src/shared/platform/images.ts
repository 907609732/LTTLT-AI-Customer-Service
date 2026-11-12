const transparent = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAIBRAA7'

/** 兼容原还原素材缺失，单张图片仅回退一次，避免递归触发 error。 */
export function installImageFallback(): () => void {
  const onError = (event: Event) => {
    const image = event.target
    if (!(image instanceof HTMLImageElement) || image.dataset.fallback) return
    image.dataset.fallback = 'true'
    image.src = transparent
  }
  document.addEventListener('error', onError, true)
  return () => document.removeEventListener('error', onError, true)
}
