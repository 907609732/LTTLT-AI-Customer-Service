/** 本地演示视图数据；真实接入时需映射为模块领域类型。 */
export interface ShopOpsPanelDemo {
  template: string
  id: {
    viewId: string
    title: string
    subtitle: string
    saveId: string
    saveLabel: string
    rootId: string
  }
  presetItems: string
  shops: Array<{ id: number; name: string }>
  isTemplate: boolean
  cfg: {
    enabled: boolean
    autoFavorite: string
    fallbackOnlineTransfer: string
    fallbackBusyTransfer: string
    mediaImage: string
    mediaVideo: string
    mediaCard: string
    smartTransfer: string
    maxAiTurnsOn: string
    maxAiTurns: string
    offlineFallbackOn: string
    fallbackOnce: string
  }
  csList: Array<string>
  keywordsItems: Array<string>
  cfgPreview: {
    orderNote: boolean
    pddAgreeNote: boolean
    pddAgreeAddr: boolean
    urgeOn: boolean
    pddCouponOn: boolean
    fallbackOn: boolean
    inviteReviewOn: boolean
    pauseAi: string
    orderNoteMode: string
    fallbackSeconds: string
    fallbackHoursOn: boolean
    fallbackStart: string
    fallbackEnd: string
    fallbackReplies: Record<string, string>
    inviteReviewIdleMin: string
    inviteReviewText: string
    pddCouponName: string
    urgeNudgeOn: string
    urgeNudgeIdleMin: string
    urgeNudgeReplies: Record<string, string>
    urgePayOn: string
    urgePayIdleMin: string
    urgePayDiscount: string
    urgePayMaxReduceYuan: string
    urgePayAlsoText: string
    urgePayText: string
  }
  ignoreKwItems: Array<string>
  saved: string
  cfgPreviewDetail: {
    enabled: boolean
    text: string
    media: Array<{ type: string; pddUrl: string; path: string; url: string }>
  }
  cfgPreviewDetailDetail: { enabled: boolean; prompt: string }
}
export function createShopOpsPanelDemo(): ShopOpsPanelDemo {
  return {
    template: '',
    id: {
      viewId: '',
      title: '',
      subtitle: '这里是示例文案',
      saveId: '',
      saveLabel: '',
      rootId: '',
    },
    presetItems: '',
    shops: [],
    isTemplate: false,
    cfg: {
      enabled: false,
      autoFavorite: '',
      fallbackOnlineTransfer: '',
      fallbackBusyTransfer: '',
      mediaImage: '',
      mediaVideo: '',
      mediaCard: '',
      smartTransfer: '',
      maxAiTurnsOn: '',
      maxAiTurns: '',
      offlineFallbackOn: '',
      fallbackOnce: '',
    },
    csList: [],
    keywordsItems: [],
    cfgPreview: {
      orderNote: false,
      pddAgreeNote: false,
      pddAgreeAddr: false,
      urgeOn: false,
      pddCouponOn: false,
      fallbackOn: false,
      inviteReviewOn: false,
      pauseAi: '',
      orderNoteMode: '',
      fallbackSeconds: '',
      fallbackHoursOn: false,
      fallbackStart: '',
      fallbackEnd: '',
      fallbackReplies: {},
      inviteReviewIdleMin: '',
      inviteReviewText: '',
      pddCouponName: '',
      urgeNudgeOn: '',
      urgeNudgeIdleMin: '',
      urgeNudgeReplies: {},
      urgePayOn: '',
      urgePayIdleMin: '',
      urgePayDiscount: '',
      urgePayMaxReduceYuan: '',
      urgePayAlsoText: '',
      urgePayText: '',
    },
    ignoreKwItems: [],
    saved: '',
    cfgPreviewDetail: { enabled: false, text: '', media: [] },
    cfgPreviewDetailDetail: { enabled: false, prompt: '' },
  }
}
