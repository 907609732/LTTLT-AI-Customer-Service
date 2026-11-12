/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface TeamPanelDemo {
  tp: string
  template: string
  teamName: { teamName: string; ownerMobile: string }
  modelValue: string
  modelValueState: string
  label: Record<string, boolean>
  isFooter: boolean
  isLoading: boolean
  templateItems: Array<string>
  isModelValue: boolean
  input: string
  isLoadingState: boolean
  mobile: { mobile: string; smsCode: string; nickname: string }
  isLoadingStateDetail: boolean
  disabled: number
  displayText: string
  isTemplate: boolean
  tpSeat__label: string
  isDisabled: boolean
  rows: Array<{ userId: string; role: string; key: string }>
  mobileSummary: { mobile: string; joinTime: string }
  isSpan: boolean
  tpOwnerRowItems: Array<{
    title: string
    items: Array<{ label: string; tip: string; key: string }>
    key: string
  }>
  displayTextSummary: string
  style: string
  isSection: boolean
  button: string
  buttonState: string
  templateItemsSummary: Array<{ type: string; key: string }>
  templateItemsSummaryDetail: Array<{ name: string; type: string; key: string }>
  isModelValueSummary: number
  isTemplateSummary: boolean
  tpSeat__track: string
}
export function createTeamPanelDemo(): TeamPanelDemo {
  return {
    tp: '',
    template: '',
    teamName: { teamName: '', ownerMobile: '' },
    modelValue: '',
    modelValueState: '',
    label: {},
    isFooter: false,
    isLoading: false,
    templateItems: [],
    isModelValue: false,
    input: '',
    isLoadingState: false,
    mobile: { mobile: '', smsCode: '', nickname: '' },
    isLoadingStateDetail: false,
    disabled: 0,
    displayText: '',
    isTemplate: false,
    tpSeat__label: '',
    isDisabled: false,
    rows: [],
    mobileSummary: { mobile: '', joinTime: '' },
    isSpan: false,
    tpOwnerRowItems: [],
    displayTextSummary: '',
    style: '',
    isSection: false,
    button: 'perm',
    buttonState: '',
    templateItemsSummary: [],
    templateItemsSummaryDetail: [],
    isModelValueSummary: 0,
    isTemplateSummary: false,
    tpSeat__track: '',
  }
}
