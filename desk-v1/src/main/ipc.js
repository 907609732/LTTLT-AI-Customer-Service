'use strict';
/**
 * IPC 层：渲染进程只通过这些通道访问主进程，不暴露任意 require。
 * 通道名集中在此，preload 与渲染层不得自行拼字符串。
 */
const { ipcMain } = require('electron');

const CHANNELS = Object.freeze({
  CONFIG_GET: 'desk:config:get',
  CONFIG_UPDATE: 'desk:config:update',
  STORES_LIST: 'desk:stores:list',
  STORES_ADD: 'desk:stores:add',
  STORES_UPDATE: 'desk:stores:update',
  STORES_REMOVE: 'desk:stores:remove',
  STORES_OPEN: 'desk:stores:open',
  STORES_CLOSE: 'desk:stores:close',
  SHOP_RESTART_CLIENT: 'desk:shop:restartClient',
  SHOP_LAUNCH_CLIENT: 'desk:shop:launchClient',
  ENGINE_START: 'desk:engine:start',
  ENGINE_STOP: 'desk:engine:stop',
  ENGINE_PAUSE: 'desk:engine:pause',
  ENGINE_RESUME: 'desk:engine:resume',
  ENGINE_STATUS: 'desk:engine:status',
  SECRETS_SET: 'desk:secrets:set',
  SECRETS_HAS: 'desk:secrets:has',
  LOGS_TAIL: 'desk:logs:tail',
});

const EVENT_CHANNEL = 'desk:event';

function registerIpc({ config, registry, engine, manager, secrets, logger, launcher = null }) {
  /** 客户端启动/重启只对 doudian-client 开放，拒绝逻辑由 launcher 统一裁决。 */
  function withStore(id, action) {
    const store = registry.get(id);
    if (!store) throw new Error(`store_not_found:${id}`);
    if (!launcher) return { ok: false, reason: 'unsupported_platform' };
    return action(store);
  }

  const handlers = {
    [CHANNELS.CONFIG_GET]: () => config.all(),
    [CHANNELS.CONFIG_UPDATE]: (_event, patch) => {
      const value = config.update(patch);
      // 配置页保存后立即生效，避免重启才能切换隐私/日志级别
      logger?.setMaskPii?.(value.privacy?.maskPii === true);
      if (value.log?.level) logger?.setLevel?.(value.log.level);
      return value;
    },
    [CHANNELS.STORES_LIST]: () =>
      registry.list().map((store) => ({
        ...store,
        // 运行态只在内存里：渲染层据此区分「未打开 / online / offline / 等待外部客户端」。
        runtime: manager?.stateOf?.(store.id) || null,
      })),
    [CHANNELS.STORES_ADD]: (_event, input) => registry.add(input),
    [CHANNELS.STORES_UPDATE]: (_event, payload) => registry.update(payload?.id, payload?.patch),
    [CHANNELS.STORES_REMOVE]: (_event, id) => registry.remove(id),
    [CHANNELS.STORES_OPEN]: async (_event, id) => {
      await manager.open(id);
      return registry.get(id);
    },
    [CHANNELS.STORES_CLOSE]: (_event, id) => manager.close(id),
    [CHANNELS.SHOP_RESTART_CLIENT]: (_event, id) =>
      withStore(id, async (store) => {
        const result = await launcher.restart(store);
        // 重启成功即重新探测，避免上一轮等待已超时后状态仍停在「连接失败」。
        if (result && result.ok) manager.retryClient?.(id);
        return result;
      }),
    [CHANNELS.SHOP_LAUNCH_CLIENT]: (_event, id) => withStore(id, (store) => launcher.launch(store)),
    [CHANNELS.ENGINE_START]: async (_event, id) => Boolean(await engine.startStore(id)),
    [CHANNELS.ENGINE_STOP]: (_event, id) => engine.stopStore(id),
    [CHANNELS.ENGINE_PAUSE]: (_event, id) => engine.pause(id),
    [CHANNELS.ENGINE_RESUME]: (_event, id) => engine.resume(id),
    [CHANNELS.ENGINE_STATUS]: () => engine.status(),
    [CHANNELS.SECRETS_SET]: (_event, payload) => secrets.setSecret(payload?.name, payload?.value),
    [CHANNELS.SECRETS_HAS]: (_event, name) => ({ has: secrets.hasSecret(name) }),
    [CHANNELS.LOGS_TAIL]: (_event, count) => logger.tail(Math.min(500, Math.max(1, Number(count) || 200))),
  };

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...args);
      } catch (err) {
        logger?.warn(`IPC ${channel} 失败：${err?.message || err}`);
        throw err;
      }
    });
  }
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
  };
}

module.exports = { registerIpc, CHANNELS, EVENT_CHANNEL };
