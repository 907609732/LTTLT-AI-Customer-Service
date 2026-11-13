/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface AutoSettingsDemo {
  rows: Array<{
    soon: string
    label: string
    items: Array<{
      key: string
      applies: string
      planOk: string
      preview: string
      dirty: string
      title: string
      meta: { tone: string; text: string }
    }>
  }>
  applies: {
    applies: string
    key: string
    title: string
    planOk: string
    preview: string
    desc: string
    editable: boolean
    meta: { tone: string; text: string }
    tone: string
    text: string
    plats: string
    join: string
    featureLabel: string
  }
  autoScope: string
  div: number
}
export function createAutoSettingsDemo(): AutoSettingsDemo {
  return {
    rows: [],
    applies: {
      applies: '',
      key: '',
      title: '',
      planOk: '',
      preview: '',
      desc: '这里是示例文案',
      editable: false,
      meta: { tone: '', text: '' },
      tone: '',
      text: '这里是示例文案',
      plats: '',
      join: '',
      featureLabel: '',
    },
    autoScope: '',
    div: 0,
  }
}
