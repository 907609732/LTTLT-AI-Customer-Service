/** 本机短提示音，不访问网络、不读取麦克风。首次声音必须由用户点击启用。 */
export async function playAssistSound(volume: number): Promise<void> {
  const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0
  if (level === 0) return
  if (typeof AudioContext === 'undefined') throw new Error('当前环境不支持提示音')
  const context = new AudioContext()
  try {
    await context.resume()
    const tone = context.createOscillator(),
      gain = context.createGain()
    tone.type = 'sine'
    tone.frequency.setValueAtTime(740, context.currentTime)
    gain.gain.setValueAtTime(level * 0.15, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.18)
    tone.connect(gain)
    gain.connect(context.destination)
    tone.start()
    tone.stop(context.currentTime + 0.2)
    await new Promise<void>((resolve) => {
      tone.onended = () => resolve()
    })
  } finally {
    await context.close()
  }
}
