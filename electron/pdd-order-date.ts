/** Native Beast range picker selectors verified on the logged-in merchant order page. */
export async function configurePddOrderDate(range: { from: string; to: string }): Promise<void> {
  const field = document.querySelector<HTMLInputElement>(
    '[data-testid="beast-core-rangePicker-htmlInput"]',
  )
  if (!field) throw Error('订单日期控件尚未识别')
  const expected = `${range.from} 00:00:00 ~ ${range.to} 23:59:59`
  if (field.value === expected) return
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 30))
  const click = async (element: Element | null | undefined) => {
    if (
      !element ||
      element.hasAttribute('disabled') ||
      /disabled/i.test(String(element.getAttribute('class')))
    )
      throw Error('订单日期选择入口不可用')
    for (const type of ['mousedown', 'mouseup', 'click'])
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    await tick()
  }
  let picker = document.querySelector('[data-testid="beast-core-rangePicker-dropdown-contentRoot"]')
  if (!picker || !picker.getClientRects().length) {
    await click(field)
    picker = document.querySelector('[data-testid="beast-core-rangePicker-dropdown-contentRoot"]')
  }
  if (!picker) throw Error('订单日期选择器尚未打开')
  for (const [endpoint, date] of [range.from, range.to].entries()) {
    const [year, month, day] = date.split('-').map(Number)
    if (!year || !month || !day) throw Error('订单日期无效')
    let side = endpoint
    for (let step = 0; step <= 120; step++) {
      const headers = Array.from(picker.querySelectorAll('[class*="RPR_panelHeader_"]'))
      const alreadyVisible = headers.findIndex(
        (header) =>
          Number(header.querySelector('input')?.value.replace(/年$/, '')) === year &&
          Number(
            header
              .querySelector('[class*="RPR_dateText_"]')
              ?.textContent?.trim()
              .replace(/月$/, ''),
          ) === month,
      )
      if (alreadyVisible >= 0) {
        side = alreadyVisible
        break
      }
      const header = headers[side]
      const currentYear = Number(header?.querySelector('input')?.value.replace(/年$/, ''))
      const currentMonth = Number(
        header?.querySelector('[class*="RPR_dateText_"]')?.textContent?.trim().replace(/月$/, ''),
      )
      if (!Number.isInteger(currentYear) || !Number.isInteger(currentMonth))
        throw Error('订单日历年月尚未识别')
      const delta = (year - currentYear) * 12 + month - currentMonth
      if (delta === 0) break
      if (step === 120) throw Error('订单日期导航超过范围，请缩小日期范围')
      await click(
        header?.querySelector(`[data-testid="beast-core-icon-${delta > 0 ? 'right' : 'left'}"]`),
      )
    }
    const table = picker.querySelectorAll('[data-testid="beast-core-rangePicker-table"]')[side]
    const days = Array.from(table?.querySelectorAll('[class*="RPR_cell_"]') ?? []).filter(
      (e) => e.getAttribute('title') === String(day) && !/outOfMonth|disabled/.test(e.className),
    )
    if (days.length !== 1) throw Error('订单日历日期不可选或不唯一')
    await click(days[0])
  }
  const reset = Array.from(picker.querySelectorAll('a')).find(
    (e) => e.textContent?.trim() === '归零',
  )
  if (!reset) throw Error('订单原生时间归零入口尚未识别')
  await click(reset)
  // Closing a Beast time popup leaves its old list mounted during the fade animation.
  await new Promise((resolve) => setTimeout(resolve, 200))
  for (const [side, time] of [
    ['begin', ['00', '00', '00']],
    ['end', ['23', '59', '59']],
  ] as const) {
    const timeInput = picker.querySelector<HTMLInputElement>(
      `[data-testid="beast-core-rangePicker-timePicker-htmlInput-${side}"]`,
    )
    if (!timeInput) throw Error('订单起止时间控件尚未识别')
    if (timeInput.value === time.join(':')) continue
    await click(timeInput)
    for (const [index, part] of ['hh', 'mm', 'ss'].entries()) {
      const list = Array.from(
        document.querySelectorAll(`[data-testid="beast-core-timePicker-list-${part}"]`),
      ).find((e) => {
        if (!e.getClientRects().length) return false
        for (let current: Element | null = e; current; current = current.parentElement) {
          const style = getComputedStyle(current)
          if (style.display === 'none' || style.visibility === 'hidden') return false
          // A newly created hidden merchant window does not paint the portal's enter
          // animation. Its mounted controls remain usable; faded-out old portals do not.
          if (style.opacity === '0' && !current.className.includes('PT_portalEnterActive_'))
            return false
        }
        return true
      })
      const option = Array.from(list?.querySelectorAll('li') ?? []).find(
        (e) => e.textContent?.trim() === time[index],
      )
      await click(option)
    }
    // Close the time popup through the range header before selecting the other endpoint.
    await click(picker.querySelector('[class*="RPR_headerWrapper_"]'))
    if (
      picker.querySelector<HTMLInputElement>(
        `[data-testid="beast-core-rangePicker-timePicker-htmlInput-${side}"]`,
      )?.value !== time.join(':')
    )
      throw Error('订单起止时间尚未确认')
  }
  const confirm = Array.from(picker.querySelectorAll('button')).find(
    (e) => e.textContent?.trim() === '确认',
  )
  await click(confirm)
  if (field.value !== expected) throw Error('原生订单日期未应用为所选整日范围，已停止读取')
}
