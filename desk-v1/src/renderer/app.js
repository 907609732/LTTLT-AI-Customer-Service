'use strict';
/** 渲染层：只通过 window.desk（preload 白名单）访问主进程。 */

const PlatformCatalog = globalThis.DeskPlatforms || {
  DEFAULT_PLATFORM_ID: 'pdd-web',
  platformOptions: () => [{ id: 'pdd-web', label: '拼多多（pdd-web）' }],
  platformDisplay: (id) => String(id || '未知平台'),
};

const UiText = globalThis.DeskUiText || {
  ERRORS: {
    doudianUnavailable: '抖店客户端未连接，请确认客户端已安装并登录后重试',
    doudianLaunchFailed: '无法启动抖店客户端，请确认已安装',
  },
  STATUS: { awaitingDoudianClient: '等待抖店客户端', awaitingClient: '等待客户端' },
  awaitingFor: (id) => (id === 'doudian-client' ? '等待抖店客户端' : '等待客户端'),
};

const DOUDIAN_PLATFORM_ID = 'doudian-client';
const LAUNCH_FAILED_TEXT = UiText.ERRORS.doudianLaunchFailed || '无法启动抖店客户端，请确认已安装';

/** 客户端连接失败一律给通用文案，不把内部探测原因透出到界面。 */
function openFailureText(platform, reason) {
  if (platform === 'doudian-client') return UiText.ERRORS.doudianUnavailable;
  return `打开失败：${reason || '未知错误'}`;
}

const storeList = document.getElementById('store-list');
const statusLine = document.getElementById('status-line');
const logs = document.getElementById('logs');
const keyState = document.getElementById('key-state');
const configState = document.getElementById('config-state');
const platformSelect = document.getElementById('platform-select');
const addForm = document.getElementById('add-form');
const collectionState = new Map();
// 重启最长等待 15s，期间 3s 轮询会重建按钮：用集合保持「重启中…」置灰状态。
const restartingStores = new Set();

/** Electron 的 invoke 异常会把通道名塞进 message，展示前剥掉。 */
function errorText(err) {
  return String(err?.message || err || '未知错误')
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '');
}

function text(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = value;
  return el;
}

function button(label, onClick, primary = false) {
  const el = text('button', primary ? 'primary' : '', label);
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
}

function initPlatformSelect() {
  for (const option of PlatformCatalog.platformOptions()) {
    const el = document.createElement('option');
    el.value = option.id;
    el.textContent = option.label;
    platformSelect.append(el);
  }
  platformSelect.value = PlatformCatalog.DEFAULT_PLATFORM_ID;
}

/** webview：未打开 / online / offline；client-inject：等待客户端或连接失败。 */
function mountChip(store) {
  const runtime = store.runtime;
  if (!runtime || !runtime.open) return text('span', 'chip idle', '未打开');
  if (runtime.awaitingClient) return text('span', 'chip wait', UiText.awaitingFor(store.platform));
  if (runtime.online) return text('span', 'chip ok', 'online');
  return text('span', 'chip lost', runtime.lastError ? '连接失败' : 'offline');
}

async function refreshStores() {
  const stores = await window.desk.stores.list();
  storeList.replaceChildren();
  if (!stores.length) {
    storeList.append(text('li', 'empty', '还没有店铺，先添加一个。'));
    return;
  }
  for (const store of stores) {
    const item = document.createElement('li');
    item.append(text('div', 'name', store.storeName));

    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.append(mountChip(store));
    const collection = collectionState.get(store.id);
    if (collection) {
      chips.append(
        text(
          'span',
          `chip ${collection.lost ? 'lost' : 'ok'}`,
          collection.lost ? `采集中断：${collection.reasonText}` : '采集正常',
        ),
      );
    }
    item.append(chips);

    item.append(
      text(
        'div',
        'meta',
        `${PlatformCatalog.platformDisplay(store.platform)} · AI ${store.aiEnabled ? '开' : '关'}`,
      ),
    );
    item.append(text('div', 'meta', store.partition));
    if (store.lastError) item.append(text('div', 'meta error', `上次错误：${store.lastError}`));

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      button('打开', async () => {
        try {
          const opened = await window.desk.stores.open(store.id);
          if (opened && opened.status === 'error') {
            statusLine.textContent = openFailureText(store.platform, opened.lastError);
          } else if (store.platform === DOUDIAN_PLATFORM_ID) {
            statusLine.textContent = `已登记「${store.storeName}」，${UiText.STATUS.awaitingDoudianClient}接入`;
          } else {
            statusLine.textContent = `已打开「${store.storeName}」`;
          }
        } catch (err) {
          statusLine.textContent = openFailureText(store.platform, errorText(err));
        }
        await refreshStores();
      }),
      button('关闭', async () => {
        try {
          await window.desk.stores.close(store.id);
        } catch (err) {
          statusLine.textContent = `关闭失败：${errorText(err)}`;
        }
        await refreshStores();
      }),
    );

    // 重启只由按钮触发：结束 doudian.exe 后重新启动，不改变「打开」的等待语义。
    if (store.platform === DOUDIAN_PLATFORM_ID) {
      const restarting = restartingStores.has(store.id);
      const restartButton = button(restarting ? '重启中…' : '重启', async () => {
        if (restartingStores.has(store.id)) return;
        restartingStores.add(store.id);
        statusLine.textContent = '重启中…';
        await refreshStores().catch(() => {});
        try {
          const result = await window.desk.stores.restartClient(store.id);
          statusLine.textContent =
            result && result.ok ? `已重启「${store.storeName}」` : LAUNCH_FAILED_TEXT;
        } catch (err) {
          statusLine.textContent = LAUNCH_FAILED_TEXT;
        } finally {
          restartingStores.delete(store.id);
          await refreshStores().catch(() => {});
        }
      });
      if (restarting) restartButton.disabled = true;
      actions.append(restartButton);
    }

    actions.append(
      button('启动回复', async () => {
        try {
          await window.desk.engine.start(store.id);
        } catch (err) {
          statusLine.textContent = `启动失败：${errorText(err)}`;
        }
      }),
      button('停止回复', () => window.desk.engine.stop(store.id)),
      button(store.aiEnabled ? '关 AI' : '开 AI', async () => {
        await window.desk.stores.update(store.id, { aiEnabled: !store.aiEnabled });
        await refreshStores();
      }),
      button('删除', async () => {
        await window.desk.stores.remove(store.id);
        await refreshStores();
      }),
    );
    item.append(actions);
    storeList.append(item);
  }
}

async function refreshStatus() {
  const status = await window.desk.engine.status();
  const ids = Object.keys(status);
  const missed = ids.reduce((sum, id) => sum + (status[id].missed || 0), 0);
  statusLine.textContent = ids.length
    ? `${ids.length} 个引擎运行中${missed ? ` · 漏回 ${missed}` : ''}`
    : '无运行中的引擎';
}

let lastLogsAt = 0;
let logsTimer = null;

async function refreshLogs() {
  lastLogsAt = Date.now();
  const lines = await window.desk.logs.tail(100);
  logs.textContent = lines.length ? lines.join('\n') : '暂无日志';
}

/** 任意 desk:event 都可能产生日志；节流到最多 1 次/秒，避免消息高峰刷爆渲染层。 */
function scheduleLogRefresh() {
  if (logsTimer) return;
  const wait = Math.max(0, 1000 - (Date.now() - lastLogsAt));
  logsTimer = setTimeout(() => {
    logsTimer = null;
    refreshLogs().catch(() => {});
  }, wait);
}

async function refreshKeyState() {
  const result = await window.desk.secrets.has('ai.apiKey');
  keyState.textContent = result.has ? '已保存' : '未配置';
}

function numberOrNaN(value) {
  const raw = String(value ?? '').trim();
  return raw === '' ? Number.NaN : Number(raw);
}

async function refreshAiConfig() {
  const config = await window.desk.config.get();
  const ai = config.ai || {};
  document.getElementById('ai-base-url').value = ai.baseUrl || '';
  document.getElementById('ai-model').value = ai.model || '';
  document.getElementById('ai-temperature').value =
    typeof ai.temperature === 'number' ? String(ai.temperature) : '';
  document.getElementById('ai-timeout').value =
    typeof ai.timeoutMs === 'number' ? String(ai.timeoutMs) : '';
  document.getElementById('ai-system-prompt').value = ai.systemPrompt || '';
}

initPlatformSelect();

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('store-name');
  const name = input.value.trim();
  if (!name) return;
  const platform = platformSelect.value || PlatformCatalog.DEFAULT_PLATFORM_ID;
  try {
    await window.desk.stores.add({ storeName: name, platform });
    input.value = '';
    statusLine.textContent = `已添加「${name}」`;
    await refreshStores();
  } catch (err) {
    statusLine.textContent = `添加失败：${errorText(err)}`;
  }
});

document.getElementById('save-config').addEventListener('click', async () => {
  configState.className = 'hint';
  configState.textContent = '保存中…';
  try {
    const updated = await window.desk.config.update({
      ai: {
        baseUrl: document.getElementById('ai-base-url').value.trim(),
        model: document.getElementById('ai-model').value.trim(),
        temperature: numberOrNaN(document.getElementById('ai-temperature').value),
        timeoutMs: numberOrNaN(document.getElementById('ai-timeout').value),
        systemPrompt: document.getElementById('ai-system-prompt').value,
      },
    });
    // 回填主进程归一化后的值（例如数字被 zod 接受后的实际类型）
    const ai = updated.ai || {};
    document.getElementById('ai-temperature').value = String(ai.temperature ?? '');
    document.getElementById('ai-timeout').value = String(ai.timeoutMs ?? '');
    configState.className = 'hint ok';
    configState.textContent = '配置已保存';
  } catch (err) {
    configState.className = 'hint error';
    configState.textContent = `保存失败：${errorText(err)}`;
  }
});

document.getElementById('save-key').addEventListener('click', async () => {
  const input = document.getElementById('ai-key');
  try {
    const result = await window.desk.secrets.set('ai.apiKey', input.value);
    keyState.textContent = result.cleared ? '已清除' : `已保存（${result.enc}）`;
    input.value = '';
  } catch (err) {
    keyState.textContent = `保存失败：${errorText(err)}`;
  }
});

document.getElementById('refresh-logs').addEventListener('click', () => {
  refreshLogs().catch(() => {});
});

window.desk.onEvent((event) => {
  // 需求：message:in / collection:lost|resumed / 任意 desk:event 都触发节流刷新。
  scheduleLogRefresh();

  if (event.type === 'collection:lost') {
    collectionState.set(event.storeId, { lost: true, reasonText: event.reasonText || event.reason || '未知原因' });
    refreshStores().catch(() => {});
    return;
  }
  if (event.type === 'collection:resumed') {
    collectionState.set(event.storeId, { lost: false, reasonText: '' });
    refreshStores().catch(() => {});
    return;
  }
  if (event.type === 'shop:closed') {
    collectionState.delete(event.storeId);
    refreshStores().catch(() => {});
    return;
  }
  if (
    event.type === 'shop:opened' ||
    event.type === 'shop:open_failed' ||
    event.type === 'shop:awaiting_client' ||
    event.type === 'shop:client_unavailable' ||
    event.type === 'shop:crash'
  ) {
    refreshStores().catch(() => {});
    if (event.type === 'shop:open_failed') {
      statusLine.textContent = openFailureText(event.platform, event.reason);
    } else if (event.type === 'shop:awaiting_client') {
      statusLine.textContent = UiText.awaitingFor(event.platform);
    } else if (event.type === 'shop:client_unavailable') {
      statusLine.textContent = event.message || UiText.ERRORS.doudianUnavailable;
    }
    return;
  }
  if (event.type === 'reply:sent' || event.type === 'reply:failed' || event.type === 'reply:transfer') {
    refreshStatus().catch(() => {});
  }
});

refreshStores().catch((err) => {
  statusLine.textContent = `店铺列表加载失败：${errorText(err)}`;
});
refreshStatus().catch(() => {});
refreshLogs().catch(() => {});
refreshKeyState().catch(() => {});
refreshAiConfig().catch((err) => {
  configState.className = 'hint error';
  configState.textContent = `配置加载失败：${errorText(err)}`;
});
setInterval(() => {
  refreshStatus().catch(() => {});
  refreshStores().catch(() => {});
}, 3000);
