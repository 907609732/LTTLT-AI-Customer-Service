/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface AccountLoginPanelDemo {
  title: {
    packageName: string
    plan: string
    nickName: string
    totalQuota: string
    remainingQuota: string
    expireAt: string
    phone: string
    masked: string
  }
  modelValue: string
  modelValueState: string
  modelValueStateDetail: string
  disabled: number
  isLoading: boolean
  isLoadingState: boolean
  isDisabled: boolean
  titleSummary: string
  displayText: string
  isDiv: boolean
  acct: string
  style: string
  div: string
  isTemplate: boolean
  displayTextSummary: string
  isTemplateSummary: boolean
  divSummary: string
}
export function createAccountLoginPanelDemo(): AccountLoginPanelDemo {
  return {
    title: {
      packageName: '',
      plan: '',
      nickName: '',
      totalQuota: '',
      remainingQuota: '',
      expireAt: '',
      phone: '',
      masked: '',
    },
    modelValue: '',
    modelValueState: '',
    modelValueStateDetail: '',
    disabled: 0,
    isLoading: false,
    isLoadingState: false,
    isDisabled: false,
    titleSummary: '',
    displayText: '',
    isDiv: false,
    acct: '',
    style: '',
    div: '',
    isTemplate: false,
    displayTextSummary: '',
    isTemplateSummary: false,
    divSummary: '',
  }
}
