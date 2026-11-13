/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface EnvHealthBannerDemo {
  missing: {
    missing: string
    online: number
    networkMessage: string
    repairing: boolean
    repairError: string
  }
  isTemplate: boolean
  div: string
  envHealthBanner__mark: string
  envHealthBanner__body: string
  envHealthBanner__action: string
  isTemplateSummary: boolean
}
export function createEnvHealthBannerDemo(): EnvHealthBannerDemo {
  return {
    missing: { missing: '', online: 3, networkMessage: '', repairing: false, repairError: '' },
    isTemplate: false,
    div: '',
    envHealthBanner__mark: '',
    envHealthBanner__body: '',
    envHealthBanner__action: '',
    isTemplateSummary: false,
  }
}
