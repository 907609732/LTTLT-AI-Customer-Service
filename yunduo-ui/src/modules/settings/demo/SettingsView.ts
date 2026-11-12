/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface SettingsViewDemo {
  loading: {
    check: string
    localVersion: string
    openAvailableDialog: string
    initialize: string
    checking: boolean
    available: string
    forceUpdate: string
    remoteVersion: string
    remark: string
  }
  model: { apiBaseUrl: string; autoStart: boolean; notifications: boolean }
  download: {
    download: { jingmaiInject: string; pdd: string; qianniu: string }
    launch: { jingmai: string; pdd: string; qianniu: string; xhs: string }
    defaults: { jingmaiInjectDir: string; pddRoot: string; qianniuRoot: string }
  }
  rows: Array<{ letter: string }>
  isLoading: boolean
  settingsAccountRow: string
}
export function createSettingsViewDemo(): SettingsViewDemo {
  return {
    loading: {
      check: '',
      localVersion: '',
      openAvailableDialog: '',
      initialize: '',
      checking: false,
      available: '',
      forceUpdate: '',
      remoteVersion: '',
      remark: '这里是示例文案',
    },
    model: { apiBaseUrl: '', autoStart: false, notifications: false },
    download: {
      download: { jingmaiInject: '', pdd: '', qianniu: '' },
      launch: { jingmai: '', pdd: '', qianniu: '', xhs: '' },
      defaults: { jingmaiInjectDir: 'C:\\JM', pddRoot: 'C:\\3664', qianniuRoot: 'C:\\QN' },
    },
    rows: [],
    isLoading: false,
    settingsAccountRow: '',
  }
}
