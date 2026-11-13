/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ScheduledTasksDialogDemo {
  stRowItems: Array<{ enabled: boolean }>
  select: {
    scheduleType: string
    hour: number
    minute: number
    second: number
    onceDate: string
    intervalValue: number
    intervalUnit: string
    command: string
  }
  rows: Array<string>
  rowsState: Array<string>
  rowsStateDetail: Array<string>
}
export function createScheduledTasksDialogDemo(): ScheduledTasksDialogDemo {
  return {
    stRowItems: [],
    select: {
      scheduleType: 'daily',
      hour: 0,
      minute: 0,
      second: 0,
      onceDate: '',
      intervalValue: 1,
      intervalUnit: 'minute',
      command: 'online',
    },
    rows: [],
    rowsState: [],
    rowsStateDetail: [],
  }
}
