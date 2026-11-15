<script setup lang="ts">
import KnowledgeCatalogDialog from './KnowledgeCatalogDialog.vue'
import KnowledgeThumbnail from './KnowledgeThumbnail.vue'
import KnowledgeProductCards from './KnowledgeProductCards.vue'
import KnowledgeDraftEditor from './KnowledgeDraftEditor.vue'
import KnowledgeReviewDialog from './KnowledgeReviewDialog.vue'
import {
  entryStatusLabel,
  scopeLabel,
  fieldLabel,
  sourceLabel,
  productStatusLabel,
  jobStatusLabel,
  jobKindLabel,
} from '../manager-labels'
import { useKnowledgeManager } from '../manager-controller'
const {
  desktop,
  storeId,
  search,
  page,
  tab,
  view,
  error,
  notice,
  loading,
  busy,
  products,
  entries,
  total,
  summary,
  jobs,
  misses,
  settings,
  capabilities,
  selection,
  allScope,
  detail,
  detailBinding,
  detailTab,
  draft,
  autosave,
  reviewEntries,
  excluded,
  affected,
  question,
  trial,
  trialSku,
  sources,
  removing,
  sourceVersions,
  addingProduct,
  newTitle,
  newProductId,
  canonicalId,
  canonicals,
  mappingReview,
  confirmShared,
  metadataTitle,
  metadataCode,
  saveProductMetadata,
  loadCanonicals,
  mappingCanonical,
  catalog,
  catalogIds,
  catalogAll,
  catalogOpen,
  catalogSearch,
  estimate,
  stores,
  currentStore,
  client,
  run,
  refresh,
  saveDraft,
  discardDraft,
  saveSettings,
  closeEditor,
  changeStore,
  changeTab,
  showView,
  openProduct,
  editEntry,
  createOverride,
  writeOne,
  createProduct,
  setScope,
  scopeValue,
  templateShop,
  prepareReview,
  confirmPublish,
  bulkReview,
  selectAll,
  select,
  removeBinding,
  bindShared,
  doTrial,
  backup,
  exportEntries,
  loadCatalog,
  collectCatalog,
  learnProduct,
  startLearn,
  chooseSources,
  hide,
  changed,
} = useKnowledgeManager()
</script>

<template>
  <main class="knowledge-manager">
    <header class="knowledge-top" data-window-drag>
      <div>
        <h1>知识库</h1>
        <p>审核后使用 · 商品与店铺范围明确</p>
      </div>
      <div class="knowledge-top-actions" data-window-no-drag>
        <label
          >当前店铺
          <select
            data-testid="knowledge-store"
            :value="storeId"
            @change="changeStore(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="shop in stores" :key="shop.id" :value="shop.id">
              {{ shop.storeName || shop.id }}
            </option>
          </select></label
        ><button aria-label="最小化" @click="desktop.minimize()">—</button
        ><button aria-label="最大化" @click="desktop.toggleMaximize()">□</button
        ><button aria-label="关闭知识库" @click="hide">×</button>
      </div>
    </header>
    <nav class="knowledge-tabs">
      <button
        :class="{ active: tab === 'products' && view === 'library' }"
        @click="changeTab('products')"
      >
        商品 <small>{{ summary?.products ?? 0 }}</small></button
      ><button
        data-testid="general-tab"
        :class="{ active: tab === 'general' && view === 'library' }"
        @click="changeTab('general')"
      >
        通用问答 <small>{{ summary?.generalEntries ?? 0 }}</small></button
      ><span class="spacer" /><button @click="showView('review')">
        待审核 {{ summary?.pending ?? 0 }}</button
      ><button @click="showView('jobs')">任务 {{ summary?.jobs ?? 0 }}</button
      ><button @click="showView('misses')">待学问题 {{ summary?.misses ?? 0 }}</button
      ><button @click="showView('settings')">设置</button>
    </nav>
    <p v-if="error" class="knowledge-alert error" role="alert">
      {{ error }}
      <button
        @click="
          () => {
            error = ''
            refresh()
          }
        "
      >
        重试读取
      </button>
    </p>
    <p v-if="notice" class="knowledge-alert">
      {{ notice }} <button @click="notice = ''">×</button>
    </p>
    <p v-if="summary?.readOnly" class="knowledge-alert error">
      知识迁移失败，当前只读：{{ summary.migration.error }}。原文件已保留，请核对迁移备份。
    </p>
    <div class="knowledge-toolbar">
      <input
        v-model="search"
        aria-label="搜索商品或问答"
        placeholder="搜索商品名称、编号或问答"
      /><button :disabled="busy || !capabilities?.catalog" @click="run(() => loadCatalog())">
        导入平台商品</button
      ><button :disabled="busy || !capabilities?.import" @click="run(chooseSources)">
        导入资料</button
      ><button
        data-testid="write-one"
        class="primary"
        :disabled="busy || summary?.readOnly || !storeId"
        @click="run(writeOne)"
      >
        ＋ 自己写一件</button
      ><button @click="run(exportEntries)">导出</button
      ><button @click="run(backup)">全库备份</button>
    </div>
    <p v-if="capabilities?.reason" class="knowledge-muted capability">{{ capabilities.reason }}</p>
    <div v-if="view === 'library' || view === 'review'" class="knowledge-selection">
      <label
        ><input
          type="checkbox"
          :checked="selection.length > 0"
          @change="
            selection = ($event.target as HTMLInputElement).checked
              ? tab === 'products' && view === 'library'
                ? products.map((p) => p.binding.id)
                : entries.map((e) => e.id)
              : []
          "
        />
        当前页</label
      ><button @click="run(selectAll)">选择当前筛选全部 {{ total }} 项</button
      ><span
        >店铺：{{ currentStore?.storeName }} · 筛选：{{ search || '全部' }} · 已选
        {{ selection.length }} {{ allScope ? '（跨页）' : '' }}</span
      ><button :disabled="!selection.length" @click="run(bulkReview)">审核所选草稿</button>
    </div>
    <section class="knowledge-content" :aria-busy="loading">
      <p v-if="loading" class="knowledge-empty">正在读取当前店铺…</p>
      <template v-else-if="view === 'library' && tab === 'products'">
        <KnowledgeProductCards
          :products="products"
          :selection="selection"
          :page="page"
          :can-learn="Boolean(capabilities?.learn)"
          :load-asset="client().asset"
          @select="select"
          @edit="(row) => run(() => openProduct(row))"
          @learn="(row) => run(() => learnProduct(row.binding))"
          @remove="
            (row) => {
              detailBinding = row.binding
              removing = true
            }
          "
          @backup="run(backup)"
        />
        <p v-if="!products.length" class="knowledge-empty">
          当前店铺尚无商品知识。可手写商品；平台采集服务接入后可先浏览在售目录，再明确选择采集范围。
        </p>
      </template>
      <template v-else-if="view === 'library' || view === 'review'"
        ><article v-for="entry in entries" :key="entry.id" class="knowledge-card">
          <input
            type="checkbox"
            :checked="selection.includes(entry.id)"
            @change="select(entry.id, ($event.target as HTMLInputElement).checked)"
          />
          <div class="knowledge-card-body">
            <b>{{ entry.draft.question }}</b
            ><span class="badge"
              >{{ entryStatusLabel(entry.status) }} · {{ scopeLabel(entry.draft.scope.kind) }} · v{{
                entry.revision
              }}</span
            >
            <p>{{ entry.draft.answer }}</p>
            <p v-if="entry.draft.scope.kind === 'template'" class="knowledge-muted">
              {{
                entry.draft.scope.storeIds.includes(storeId)
                  ? '已应用于当前店铺'
                  : '公共模板尚未应用于当前店铺；编辑模板可选择应用店铺'
              }}
            </p>
            <small class="knowledge-muted"
              >{{ entry.draft.sourceRefs.length }} 个来源版本 ·
              {{
                entry.draft.expiresAt
                  ? new Date(entry.draft.expiresAt).toLocaleString() + ' 到期'
                  : '静态事实'
              }}</small
            >
          </div>
          <div class="knowledge-card-actions">
            <button
              @click="
                run(async () => {
                  await saveDraft()
                  editEntry(entry)
                })
              "
            >
              编辑</button
            ><button
              v-if="entry.draft.scope.kind === 'template'"
              @click="run(() => createOverride(entry))"
            >
              为本店创建覆盖</button
            ><button class="primary" @click="run(() => prepareReview([entry]))">审核</button
            ><button
              :disabled="!entry.approved"
              @click="
                run(async () => {
                  await client().command({
                    type: 'withdraw',
                    entryId: entry.id,
                    expectedRevision: entry.revision,
                  })
                  await refresh()
                })
              "
            >
              撤回
            </button>
          </div>
        </article>
        <p v-if="!entries.length" class="knowledge-empty">
          当前范围没有问答。可手写问题和标准答案，保存草稿后单独审核发布。
        </p></template
      >
      <template v-else-if="view === 'jobs'"
        ><article v-for="job in jobs" :key="job.id" class="knowledge-card">
          <div class="knowledge-card-body">
            <b>{{ jobKindLabel(job.kind) }} · {{ jobStatusLabel(job.status) }}</b>
            <p>
              {{ job.progress.completed }} / {{ job.progress.total ?? '总量未知' }} {{ job.error }}
            </p>
            <small>{{ job.id }}</small>
          </div>
          <button
            v-if="job.status === 'running'"
            @click="
              run(async () => {
                await client().pipeline({ action: 'pause', storeId: job.storeId, jobId: job.id })
                await refresh()
              })
            "
          >
            暂停</button
          ><button
            v-if="job.status === 'paused'"
            @click="
              run(async () => {
                await client().pipeline({ action: 'resume', storeId: job.storeId, jobId: job.id })
                await refresh()
              })
            "
          >
            继续</button
          ><button
            :disabled="['succeeded', 'cancelled', 'failed'].includes(job.status)"
            @click="
              run(async () => {
                await client().pipeline({ action: 'cancel', storeId: job.storeId, jobId: job.id })
                await refresh()
              })
            "
          >
            取消
          </button>
        </article>
        <p v-if="!jobs.length" class="knowledge-empty">
          当前店铺没有采集或学习任务。退出后的学习任务保持暂停，不会自动产生模型费用。
        </p></template
      >
      <template v-else-if="view === 'misses'"
        ><article v-for="miss in misses" :key="miss.id" class="knowledge-card">
          <div class="knowledge-card-body">
            <b>{{ miss.question }}</b>
            <p>
              出现 {{ miss.count }} 次 · 商品 {{ miss.productId || '未识别' }} · SKU
              {{ miss.skuId || '未识别' }} · {{ miss.conversationIds.length }} 个真实会话 ·
              {{ miss.status }}
            </p>
          </div>
          <button
            @click="
              run(async () => {
                await saveDraft()
                tab = 'general'
                await writeOne()
                if (draft) {
                  draft.question = miss.question
                  changed()
                }
              })
            "
          >
            补充答案</button
          ><button
            @click="
              run(async () => {
                await client().command({ type: 'update-miss', missId: miss.id, status: 'resolved' })
                await refresh()
              })
            "
          >
            标记解决</button
          ><button
            @click="
              run(async () => {
                await client().command({ type: 'update-miss', missId: miss.id, status: 'ignored' })
                await refresh()
              })
            "
          >
            忽略
          </button>
        </article>
        <p v-if="!misses.length" class="knowledge-empty">
          当前没有待学问题。仅正式接待未覆盖的问题进入此处，试问不计入。
        </p></template
      >
      <form v-else-if="settings" class="knowledge-settings" @submit.prevent="run(saveSettings)">
        <label
          >动态资料有效期（分钟）<input
            v-model.number="settings.dynamicTtlMinutes"
            type="number"
            min="1"
            max="10080" /></label
        ><label
          >每日资料检查时间（Asia/Shanghai）<input
            v-model="settings.dailyCheckTime"
            type="time" /></label
        ><label
          ><input v-model="settings.dailyCheckEnabled" type="checkbox" />
          应用运行时每日检查；只采集比较，学习需另行确认</label
        >
        <p v-if="!capabilities?.dailyCheck" class="knowledge-muted">
          当前每日检查执行器尚未接入，保存时间不会声称后台已运行。
        </p>
        <button class="primary">保存设置</button>
      </form>
    </section>
    <footer v-if="view === 'library' || view === 'review'" class="knowledge-pagination">
      <span>共 {{ total }} 项 · 每页20项</span
      ><button :disabled="page === 0" @click="page--">上一页</button
      ><span>{{ page + 1 }} / {{ Math.max(1, Math.ceil(total / 20)) }}</span
      ><button :disabled="(page + 1) * 20 >= total" @click="page++">下一页</button
      ><button @click="refresh">刷新</button>
    </footer>

    <section v-if="detail || draft" class="knowledge-workspace" aria-label="知识编辑与审核">
      <header>
        <div>
          <h2>{{ detail?.canonical?.title || '通用问答编辑' }}</h2>
          <span class="knowledge-muted"
            >{{ detailBinding?.productId || currentStore?.storeName }} · {{ autosave }}</span
          >
        </div>
        <button @click="run(closeEditor)">保存并关闭</button>
      </header>
      <nav>
        <button @click="detailTab = 'qa'">知识问答</button
        ><button v-if="detail" @click="detailTab = 'sources'">原始资料 / 来源版本</button
        ><button @click="detailTab = 'trial'">试问</button
        ><button
          v-if="detail"
          @click="
            run(async () => {
              detailTab = 'bindings'
              await loadCanonicals()
            })
          "
        >
          共享与SKU关联
        </button>
      </nav>
      <div v-if="detailTab === 'qa'" class="knowledge-review-grid">
        <div class="knowledge-entry-list">
          <p class="knowledge-muted">
            已审核 {{ detail?.entries.filter((e) => e.approved).length || 0 }} 条；自动保存不发布。
          </p>
          <button v-if="detail" @click="run(writeOne)">＋ 手写问答</button
          ><button
            v-for="entry in detail?.entries"
            :key="entry.id"
            class="knowledge-entry"
            @click="
              run(async () => {
                await saveDraft()
                editEntry(entry)
              })
            "
          >
            <b>{{ entry.draft.question }}</b
            ><span
              >{{ entryStatusLabel(entry.status) }} · {{ scopeLabel(entry.draft.scope.kind) }} ·
              {{ fieldLabel(entry.draft.field) }}</span
            >
          </button>
          <details v-if="sources.length">
            <summary>对照原始资料（{{ sources.length }}）</summary>
            <pre v-for="source in sources" :key="source.id"
              >{{ source.label }} v{{ source.revision }}
{{ source.text }}</pre
            >
          </details>
        </div>
        <KnowledgeDraftEditor
          v-if="draft"
          :draft="draft"
          :bindings="detail?.bindings.filter((b) => b.storeId === storeId) || []"
          :stores="stores"
          :has-canonical="Boolean(detail?.canonical)"
          :scope-value="scopeValue"
          @patch="
            (patch) => {
              if (draft) {
                draft = { ...draft, ...patch }
                changed()
              }
            }
          "
          @scope="setScope"
          @template="templateShop"
          @save="run(saveDraft)"
          @review="run(() => prepareReview())"
          @discard="discardDraft"
        />
        <p v-else class="knowledge-empty">选择条目进行编辑与来源对照，或手写新的问答。</p>
      </div>
      <div v-else-if="detailTab === 'sources'" class="knowledge-sources">
        <article v-for="source in sources" :key="source.id">
          <b>{{ source.label }} · v{{ source.revision }}</b>
          <p>
            {{ sourceLabel(source.kind) }} · {{ new Date(source.updatedAt).toLocaleString() }} ·
            {{ JSON.stringify(source.locator) }}
          </p>
          <pre>{{ source.text }}</pre>
          <KnowledgeThumbnail
            v-for="assetId in source.assetIds"
            :key="assetId"
            :asset-id="assetId"
            :load="client().asset"
          /><button
            @click="
              run(async () => {
                sourceVersions = await client().sourceHistory(source.id)
              })
            "
          >
            查看版本历史
          </button>
        </article>
        <p v-if="!sources.length">此商品没有原始资料。手写知识仍需独立审核。</p>
        <details v-if="sourceVersions.length" open>
          <summary>来源版本历史</summary>
          <pre v-for="source in sourceVersions" :key="source.revision">
v{{ source.revision }} · {{ source.hash }}
{{ source.text }}</pre
          >
        </details>
      </div>
      <div v-else-if="detailTab === 'trial'" class="knowledge-trial">
        <p class="knowledge-muted">
          使用当前模型及同一审核知识检索器；试问不发送买家消息、不加入待学问题。
        </p>
        <select v-model="trialSku">
          <option value="">未指定SKU</option>
          <option
            v-for="binding in detail?.bindings.filter((b) => b.storeId === storeId && b.skuId)"
            :key="binding.id"
            :value="binding.skuId"
          >
            {{ binding.skuId }}
          </option></select
        ><input v-model="question" placeholder="输入买家问题" @keyup.enter="run(doTrial)" /><button
          class="primary"
          @click="run(doTrial)"
        >
          试问当前模型
        </button>
        <article v-if="trial">
          <p>{{ trial.answer }}</p>
          <p class="knowledge-muted">
            商品状态：{{ productStatusLabel(trial.resolution.productStatus) }} · 完整依据
            {{ trial.resolution.citations.length }} 条 · 预算省略 {{ trial.resolution.omitted }} 条
            · 已过期字段 {{ trial.resolution.expiredFields.join('、') || '无' }}
          </p>
          <details v-for="citation in trial.resolution.citations" :key="citation.entryId">
            <summary>{{ citation.question }} · v{{ citation.entryRevision }}</summary>
            <p>{{ citation.answer }}</p>
            <small>{{ JSON.stringify(citation.sourceRefs) }}</small>
          </details>
        </article>
      </div>
      <div v-else class="knowledge-bindings">
        <form @submit.prevent="run(saveProductMetadata)">
          <label>共享商品名称<input v-model="metadataTitle" required maxlength="1000" /></label
          ><label>共享商品编码<input v-model="metadataCode" maxlength="200" /></label
          ><button>保存共享名称与编码</button>
        </form>
        <p>
          共享发布将影响：{{
            [
              ...new Set(
                detail?.bindings.map(
                  (b) => stores.find((s) => s.id === b.storeId)?.storeName || b.storeId,
                ),
              ),
            ].join('、')
          }}。平台商品ID相同不代表同款；确认同款后根商品及全部SKU整体关联，SKU仅维护本店差异。
        </p>
        <div v-for="binding in detail?.bindings" :key="binding.id">
          {{ stores.find((s) => s.id === binding.storeId)?.storeName }} · {{ binding.productId }} ·
          {{ binding.skuId || '根商品' }} · 修订{{ binding.revision }}
        </div>
        <label
          >目标共享商品<select v-model="mappingCanonical">
            <option value="">人工确认同款</option>
            <option v-for="canonical in canonicals" :key="canonical.id" :value="canonical.id">
              {{ canonical.title }} · {{ canonical.code || canonical.id }}
            </option>
          </select></label
        ><button @click="run(bindShared)">预览整体同款关联</button>
      </div>
    </section>
    <KnowledgeReviewDialog
      v-if="reviewEntries.length"
      :entries="reviewEntries"
      :affected="affected"
      :excluded="excluded"
      :pending="busy"
      @exclude="
        (id, value) => {
          excluded = value ? [...excluded, id] : excluded.filter((v) => v !== id)
        }
      "
      @confirm="run(confirmPublish)"
      @close="reviewEntries = []"
    />
    <div v-if="mappingReview" class="knowledge-modal-backdrop">
      <section class="knowledge-modal" role="dialog" aria-label="整体同款关联">
        <h2>确认根商品及全部SKU整体关联</h2>
        <p>
          本店商品 {{ mappingReview.root.productId }} → 共享商品「{{
            mappingReview.target.title
          }}」。共享发布涉及店铺：{{ mappingReview.shops.join('、') }}。
        </p>
        <p>
          全部
          {{ mappingReview.bindings.filter((b) => b.skuId).length }}
          个SKU将继承同一共享商品；本店知识覆盖、价格库存、活动及来源保留。任一版本变化将全量拒绝，旧待发送引用失效。
        </p>
        <ul>
          <li v-for="binding in mappingReview.bindings" :key="binding.id">
            {{ binding.skuId || '根商品' }} · {{ binding.title || binding.productId }} · 修订
            {{ binding.revision }}
          </li>
        </ul>
        <footer>
          <button @click="mappingReview = undefined">取消</button
          ><button class="primary" @click="run(confirmShared)">明确确认整体关联</button>
        </footer>
      </section>
    </div>
    <div v-if="addingProduct" class="knowledge-modal-backdrop">
      <form class="knowledge-modal" @submit.prevent="run(createProduct)">
        <h2>手写一件商品</h2>
        <label>本店商品名称<input v-model="newTitle" required /></label
        ><label>本店平台商品编号<input v-model="newProductId" required /></label
        ><label
          >共享商品<select v-model="canonicalId">
            <option value="">新建独立共享商品（不自动归并）</option>
            <option v-for="canonical in canonicals" :key="canonical.id" :value="canonical.id">
              {{ canonical.title }} · {{ canonical.code || canonical.id }}
            </option>
          </select></label
        >
        <p>选择已有共享商品即明确关联同款，已审核静态知识会应用于此店；价格库存不会跨店共享。</p>
        <footer>
          <button type="button" @click="addingProduct = false">取消</button
          ><button class="primary">确认创建本店关联</button>
        </footer>
      </form>
    </div>
    <div v-if="removing && detailBinding" class="knowledge-modal-backdrop">
      <section class="knowledge-modal">
        <h2>解除当前店铺关联</h2>
        <p>
          {{ currentStore?.storeName }} ·
          {{
            detailBinding.productId
          }}：同时解除此商品所有SKU关联，使其待发送引用失效；其他店铺共享内容保留。
        </p>
        <footer>
          <button @click="removing = false">取消</button
          ><button
            class="danger"
            @click="
              run(async () => {
                if (detailBinding) await removeBinding(detailBinding)
                removing = false
              })
            "
          >
            确认解除本店关联
          </button>
        </footer>
      </section>
    </div>
    <KnowledgeCatalogDialog
      v-if="catalogOpen && catalog"
      :catalog="catalog"
      :store-name="currentStore?.storeName || ''"
      :search="catalogSearch"
      :busy="busy"
      v-model:selected="catalogIds"
      v-model:all="catalogAll"
      @close="catalogOpen = false"
      @next="(cursor) => run(() => loadCatalog(cursor))"
      @collect="run(collectCatalog)"
    />
    <div v-if="estimate" class="knowledge-modal-backdrop">
      <section class="knowledge-modal">
        <h2>确认开始学习</h2>
        <p>
          {{ estimate.sources }} 份资料 · {{ estimate.images }} 张图片 ·
          {{ estimate.characters }} 字 · 预计 {{ estimate.estimatedTokens }} token
        </p>
        <p>{{ estimate.message }}。将使用当前模型，结果仅为待审核草稿。</p>
        <footer>
          <button @click="estimate = undefined">取消</button
          ><button class="primary" @click="run(startLearn)">明确开始模型学习</button>
        </footer>
      </section>
    </div>
  </main>
</template>

<style src="../manager.css"></style>
