/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface GeneralPanelDemo {
  useHumanHistory: {
    useHumanHistory: boolean
    windowSnap: boolean
    filterReplyLink: boolean
    enableThinking: boolean
  }
  isDisabled: boolean
}
export function createGeneralPanelDemo(): GeneralPanelDemo {
  return {
    useHumanHistory: {
      useHumanHistory: false,
      windowSnap: false,
      filterReplyLink: false,
      enableThinking: false,
    },
    isDisabled: false,
  }
}
