/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface AccountSettingsDialogDemo {
  isAsTableBody: boolean
  asTableBodyItems: Array<string>
  input: string
  asSelect: string
  asSelectState: string
  isDisabled: boolean
  id: {
    id: number
    name: string
    userName: string
    platformName: string
    account: string
    password: string
    credentialAutoLoginDisabled: string
    credentialAutoLoginError: string
  }
  rows: Array<{ id: string; name: string }>
  asRowItems: Array<{
    name: string
    userName: string
    platformName: string
    credentialAutoLoginDisabled: string
    account: string
    credentialAutoLoginError: string
    hasPassword: boolean
  }>
  inputState: Record<string, never>
}
export function createAccountSettingsDialogDemo(): AccountSettingsDialogDemo {
  return {
    isAsTableBody: false,
    asTableBodyItems: [],
    input: '',
    asSelect: 'all',
    asSelectState: 'all',
    isDisabled: false,
    id: {
      id: 1,
      name: '',
      userName: '',
      platformName: '',
      account: '',
      password: '',
      credentialAutoLoginDisabled: '',
      credentialAutoLoginError: '',
    },
    rows: [],
    asRowItems: [],
    inputState: {},
  }
}
