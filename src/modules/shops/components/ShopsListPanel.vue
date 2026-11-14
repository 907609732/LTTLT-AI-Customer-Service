<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { notifyUnavailable } from '@/shared/ui/feedback'
import type { LocalStore } from '@/shared/contracts/backend'
import AddShopDialog from './AddShopDialog.vue'
import pddIcon from '@/assets/figma-add-img00.png'
import qianniuIcon from '@/assets/figma-add-img3.png'
import xianyuIcon from '@/assets/figma-add-img31.png'
import douyinIcon from '@/assets/figma-add-img1.png'

const platformIcons: Record<string, string> = {
  'pdd-web': pddIcon,
  'pdd-client': pddIcon,
  qianniu: qianniuIcon,
  xianyu: xianyuIcon,
  'doudian-web': douyinIcon,
  'doudian-client': douyinIcon,
}

const runtime = useRuntimeStore(),
  router = useRouter(),
  task = useTask()
const platform = ref(''),
  group = ref(''),
  search = ref(''),
  status = ref('')
const page = ref(1),
  size = ref(10),
  adding = ref(false)
const drafts = reactive<Record<string, string>>({})
const saved = ref('')
const savingStore = ref('')
const stores = computed(() => runtime.snapshot.stores)
const platforms = computed(() => [...new Set(stores.value.map((s) => s.platform))])
const groups = computed(() => [...new Set(stores.value.map((s) => s.group).filter(Boolean))])
const platformName = (id: string) =>
  runtime.snapshot.capabilities.platforms.find((p) => p.id === id)?.label ||
  {
    'pdd-web': '拼多多网页版',
    'pdd-client': '拼多多客户端',
    'doudian-client': '抖店客户端',
    qianniu: '千牛',
    'sim-local': '本机模拟',
  }[id] ||
  id
// 连接成功不能证明已登录；只有明确认证结果才显示登录状态。
function loginState(shop: LocalStore) {
  return shop.runtime.authenticated === true && shop.runtime.online
    ? 'yes'
    : shop.runtime.authenticated === false
      ? 'no'
      : 'unknown'
}
const logged = computed(() => stores.value.filter((s) => loginState(s) === 'yes').length)
const filtered = computed(() =>
  stores.value.filter(
    (s) =>
      (!platform.value || s.platform === platform.value) &&
      (!group.value || (group.value === '__none__' ? !s.group : s.group === group.value)) &&
      (!status.value || loginState(s) === status.value) &&
      `${s.storeName} ${s.group}`
        .toLocaleLowerCase()
        .includes(search.value.trim().toLocaleLowerCase()),
  ),
)
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / size.value)))
const rows = computed(() =>
  filtered.value.slice((page.value - 1) * size.value, page.value * size.value),
)
watch([platform, group, status, search, size], () => {
  page.value = 1
})
watch(pages, (value) => {
  page.value = Math.min(page.value, value)
})
watch(
  () => runtime.snapshot.workspaceId,
  () => {
    Object.keys(drafts).forEach((key) => Reflect.deleteProperty(drafts, key))
    saved.value = ''
    page.value = 1
  },
)
function navigate(shop: LocalStore, panel: string) {
  runtime.selectedStoreId = shop.id
  void router.push({ path: '/shop/manage', query: { panel } })
}
async function refresh() {
  await task.run(async () => {
    await runtime.refresh()
    if (runtime.error) throw new Error(runtime.error)
  })
}
async function saveGroup(shop: LocalStore) {
  const value = (drafts[shop.id] ?? shop.group).trim()
  if (value === shop.group) return
  const workspace = runtime.snapshot.workspaceId
  if (task.pending.value) return
  savingStore.value = shop.id
  await task.run(async () => {
    await runtime.run({ action: 'set-store-group', storeId: shop.id, values: { group: value } })
    if (workspace === runtime.snapshot.workspaceId) {
      Reflect.deleteProperty(drafts, shop.id)
      saved.value = shop.id
      task.message.value = '分组已保存'
    }
  })
  savingStore.value = ''
}
function changeDraft(shop: LocalStore, event: Event) {
  drafts[shop.id] = (event.target as HTMLInputElement).value
  saved.value = ''
}
async function connect(shop: LocalStore) {
  const workspace = runtime.snapshot.workspaceId
  await task.run(async () => {
    await runtime.run({ action: 'open-store', storeId: shop.id })
    if (workspace !== runtime.snapshot.workspaceId || !stores.value.some((s) => s.id === shop.id))
      return
    runtime.selectedStoreId = shop.id
    runtime.platformStoreId = shop.id
    await router.push('/')
  })
}
async function remove(shop: LocalStore) {
  const workspace = runtime.snapshot.workspaceId
  try {
    await ElMessageBox.confirm(
      `从本机移除“${shop.storeName || '待识别店铺'}”？本机会保留移除备份，平台店铺不会被删除。`,
      '移除店铺',
      { type: 'warning' },
    )
  } catch {
    return
  }
  await task.run(async () => {
    if (workspace !== runtime.snapshot.workspaceId) throw new Error('工作区已切换，请重新操作')
    await runtime.run({ action: 'remove-store', storeId: shop.id, values: { confirmed: true } })
    if (workspace === runtime.snapshot.workspaceId && runtime.platformStoreId === shop.id)
      runtime.platformStoreId = ''
  })
}
function reset() {
  platform.value = ''
  group.value = ''
  search.value = ''
  status.value = ''
}
const reception = [
  { key: 'transfer', title: '转接人工' },
  { key: 'welcome', title: '进店欢迎' },
  { key: 'auto', title: '自动操作·全局' },
  { key: 'image', title: '图片识别' },
]
</script>

<template>
  <section class="shops-restored" data-v-ffbd3484="">
    <div class="page-head" data-v-ffbd3484="">
      <div>
        <h1>店铺与商品</h1>
        <p>
          登录店铺 → 管理商品知识 → 配置接待。支持手动维护 / CSV；平台自动学习、跨店同步未接入。
        </p>
      </div>
      <div class="page-head__acts">
        <button
          class="btn"
          :disabled="!runtime.available || task.pending.value"
          @click="adding = true"
        >
          添加店铺</button
        ><button
          class="btn btn--ghost"
          :disabled="runtime.loading || task.pending.value"
          @click="refresh"
        >
          刷新
        </button>
      </div>
    </div>
    <p v-if="!runtime.available" role="status">浏览器仅提供界面预览，请在桌面版管理店铺。</p>
    <p v-if="task.error.value || runtime.error" class="list-error" role="alert">
      {{ task.error.value || runtime.error }}
    </p>
    <p v-if="task.message.value" role="status">{{ task.message.value }}</p>
    <div class="panel shops-panel" data-v-ffbd3484="">
      <div class="panel__bar shops-panel__bar" data-v-ffbd3484="">
        <div class="panel__title">
          店铺列表 <b>{{ stores.length }}</b
          ><span class="shop-stat"
            ><button
              :aria-pressed="status === 'yes'"
              @click="status = status === 'yes' ? '' : 'yes'"
            >
              已登录 {{ logged }}
            </button></span
          >
        </div>
        <div class="panel__tools">
          <select v-model="status" aria-label="登录状态筛选">
            <option value="">全部状态</option>
            <option value="yes">已登录</option>
            <option value="no">未登录</option>
            <option value="unknown">登录待确认</option>
          </select>
          <select v-model="platform" aria-label="平台筛选">
            <option value="">全部平台</option>
            <option v-for="id in platforms" :key="id" :value="id">{{ platformName(id) }}</option>
          </select>
          <select v-model="group" aria-label="分组筛选">
            <option value="">全部分组</option>
            <option value="__none__">未分组</option>
            <option v-for="name in groups" :key="name" :value="name">{{ name }}</option>
          </select>
          <input
            v-model="search"
            type="search"
            aria-label="搜索店铺"
            placeholder="搜索店名、分组"
          />
        </div>
      </div>
      <datalist id="shop-group-options">
        <option v-for="name in groups" :key="name" :value="name" />
      </datalist>
      <div class="shops-list" :aria-busy="runtime.loading">
        <article v-for="shop in rows" :key="shop.id" class="shop-card" :data-store="shop.id">
          <div class="shop-card__lead">
            <img
              v-if="platformIcons[shop.platform]"
              class="store-platform"
              :src="platformIcons[shop.platform]"
              alt=""
            />
            <span v-else class="store-platform" aria-hidden="true">{{
              platformName(shop.platform).slice(0, 1)
            }}</span>
            <div class="store-identity">
              <div class="store-name">
                <strong>{{ shop.storeName || '待识别店铺' }}</strong
                ><input
                  :value="drafts[shop.id] ?? shop.group"
                  list="shop-group-options"
                  maxlength="20"
                  :aria-label="`${shop.storeName}分组`"
                  placeholder="分组"
                  :disabled="task.pending.value"
                  @input="changeDraft(shop, $event)"
                  @change="saveGroup(shop)"
                  @keydown.enter.prevent="saveGroup(shop)"
                />
              </div>
              <small
                >{{ platformName(shop.platform) }} ·
                {{
                  loginState(shop) === 'yes'
                    ? '已登录'
                    : loginState(shop) === 'no'
                      ? '未登录'
                      : '登录待确认'
                }}
                · {{ shop.runtime.online ? '已连接' : '未连接' }}</small
              >
              <small
                v-if="drafts[shop.id] !== undefined && drafts[shop.id]?.trim() !== shop.group"
                >{{ savingStore === shop.id ? '保存中…' : '分组待保存，按 Enter 重试' }}</small
              ><small v-else-if="saved === shop.id">分组已保存</small>
              <small
                v-if="shop.runtime.lastError || shop.runtime.identityError"
                class="list-error"
                >{{ shop.runtime.lastError || shop.runtime.identityError }}</small
              >
            </div>
          </div>
          <div class="shop-card__col">
            <div class="shop-card__col-hd"><b>接待配置</b><em>按店设置接待</em></div>
            <div class="shop-card__acts">
              <button
                v-for="item in reception"
                :key="item.key"
                class="chip"
                :data-panel="item.key"
                @click="navigate(shop, item.key)"
              >
                {{ item.title }}</button
              ><button
                class="chip"
                title="跨店同步尚未接入"
                @click="notifyUnavailable('跨店配置同步')"
              >
                同步他店
              </button>
            </div>
          </div>
          <div class="shop-card__col knowledge-col">
            <div class="shop-card__col-hd"><b>商品知识</b><em>本机资料</em></div>
            <div class="shop-card__acts">
              <button class="chip" data-panel="goods" @click="navigate(shop, 'goods')">
                查看商品</button
              ><button class="chip" :disabled="task.pending.value" @click="connect(shop)">
                {{ loginState(shop) === 'yes' ? '打开店铺' : '登录 / 检查连接' }}
              </button>
            </div>
          </div>
          <button class="shop-card__del" :disabled="task.pending.value" @click="remove(shop)">
            移除
          </button>
        </article>
        <div v-if="!rows.length" class="shops-empty">
          <template v-if="runtime.loading">正在读取店铺…</template
          ><template v-else-if="!stores.length">尚未添加店铺，请先添加并登录店铺。</template
          ><template v-else
            >没有符合筛选条件的店铺 <button @click="reset">清空筛选</button></template
          >
        </div>
      </div>
      <div class="list-pager">
        <div>
          共 {{ filtered.length }} 家店铺
          <select v-model.number="size" aria-label="每页数量">
            <option v-for="n in [5, 10, 20, 50]" :key="n" :value="n">{{ n }} 条/页</option>
          </select>
        </div>
        <div class="pager-actions">
          <button aria-label="上一页" :disabled="page <= 1" @click="page--">上一页</button
          ><span>{{ page }} / {{ pages }}</span
          ><button aria-label="下一页" :disabled="page >= pages" @click="page++">下一页</button>
        </div>
      </div>
    </div>
    <AddShopDialog v-model="adding" />
  </section>
</template>

<style scoped>
.shops-restored {
  padding: 18px 28px 24px;
  color: #263550;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-height: 0;
}
.shops-restored .page-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 24px;
}
.shops-restored h1 {
  font-size: 20px;
  margin: 0 0 6px;
}
.shops-restored p,
.shops-restored small {
  color: #8394af;
  font-size: 12px;
  margin: 0;
}
.shops-restored .page-head__acts {
  display: flex;
  gap: 8px;
  align-items: center;
}
.shops-restored button,
.shops-restored select,
.shops-restored input {
  font: inherit;
}
.shops-restored button,
.shops-restored select,
.shops-restored input {
  border: 1px solid #b9d2ff;
  border-radius: 18px;
  background: white;
  color: #426088;
  padding: 6px 12px;
}
.shops-restored button {
  cursor: pointer;
  white-space: nowrap;
}
.shops-restored button:disabled {
  opacity: 0.5;
  cursor: default;
}
.shops-restored button:focus-visible,
.shops-restored input:focus-visible,
.shops-restored select:focus-visible {
  outline: 2px solid #347bff;
  outline-offset: 2px;
}
.shops-restored .shops-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid #c8ddff;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 4px 14px #3978d009;
  overflow: hidden;
}
.shops-restored .shops-panel__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
  background: #f8fbff;
  border-bottom: 1px solid #c8ddff;
}
.shops-restored .panel__title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 700;
}
.shops-restored .panel__title > b {
  color: #347bff;
  background: #e9f3ff;
  border-radius: 50%;
  padding: 2px 6px;
}
.shops-restored .shop-stat button {
  color: #0c9e6b;
  background: #d9fae9;
  border: 0;
  font-size: 12px;
}
.shops-restored .shop-stat button[aria-pressed='true'] {
  outline: 2px solid #15ac79;
}
.shops-restored .panel__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}
.shops-restored .panel__tools input {
  width: 180px;
  min-width: 0;
}
.shops-restored .shops-list {
  flex: 1;
  min-height: 180px;
  overflow: auto;
  padding: 8px 16px;
}
.shops-restored .shop-card {
  display: grid;
  grid-template-columns: minmax(210px, 0.9fr) minmax(480px, 2fr) minmax(210px, 0.85fr) auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
  padding: 8px 10px;
  border: 1px solid #b4d0ff;
  border-radius: 14px;
  background: #fbfdff;
}
.shops-restored .shop-card__lead {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.store-platform {
  background: #e7f0ff;
  color: #2879ef;
  border-radius: 9px;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  font-weight: bold;
}
.store-identity {
  min-width: 0;
}
.store-name {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 14px;
}
.store-name strong {
  overflow-wrap: anywhere;
}
.shops-restored .store-name input {
  width: 70px;
  padding: 2px 7px;
  font-size: 11px;
}
.shops-restored small {
  display: block;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.shops-restored .shop-card__col {
  border: 1px solid #b9d2ff;
  border-radius: 9px;
  padding: 6px 8px;
  background: #f0f6ff;
  min-width: 0;
}
.shops-restored .shop-card__col-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 5px;
}
.shops-restored em {
  color: #8c9fba;
  font-size: 10px;
  font-style: normal;
}
.shops-restored .shop-card__acts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.shops-restored .chip {
  font-size: 12px;
  font-weight: 600;
  color: #2876ed;
  padding: 3px 8px;
  box-shadow: 0 1px 3px #2469ba12;
}
.shops-restored .shop-card__del {
  border: 0;
  background: transparent;
  color: #8a9bb3;
  padding: 4px;
  font-size: 12px;
}
.shops-restored .shops-empty {
  padding: 40px 16px;
  text-align: center;
  color: #8394af;
}
.shops-restored .list-pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid #c8ddff;
  font-size: 12px;
  color: #8394af;
}
.pager-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.shops-restored .list-error {
  color: #c43c3c;
  margin-bottom: 8px;
}
@media (max-width: 1250px) {
  .shops-restored .shop-card {
    grid-template-columns: minmax(170px, 1fr) minmax(320px, 2fr);
  }
  .knowledge-col {
    grid-column: 2;
  }
  .shops-restored .shop-card__del {
    grid-column: 1;
    grid-row: 2;
    justify-self: start;
  }
}
@media (max-width: 1000px) {
  .shops-restored {
    padding: 20px 12px;
    overflow: auto;
  }
  .shops-restored .shop-card {
    grid-template-columns: 1fr;
  }
  .knowledge-col,
  .shops-restored .shop-card__del {
    grid-column: auto;
    grid-row: auto;
  }
  .shops-restored .shops-panel {
    flex: none;
    min-height: 500px;
  }
  .shops-restored .page-head {
    flex-wrap: wrap;
  }
  .shops-restored .list-pager {
    flex-wrap: wrap;
  }
}
</style>
