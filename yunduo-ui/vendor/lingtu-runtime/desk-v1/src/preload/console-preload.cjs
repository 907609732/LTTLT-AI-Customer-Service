'use strict';
/** 控制台窗口 preload：只暴露固定通道，不把 ipcRenderer 整体交给渲染层。 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('desk', {
  config: {
    get: () => invoke('desk:config:get'),
    update: (patch) => invoke('desk:config:update', patch),
  },
  stores: {
    list: () => invoke('desk:stores:list'),
    add: (input) => invoke('desk:stores:add', input),
    update: (id, patch) => invoke('desk:stores:update', { id, patch }),
    remove: (id) => invoke('desk:stores:remove', id),
    open: (id) => invoke('desk:stores:open', id),
    close: (id) => invoke('desk:stores:close', id),
    restartClient: (id) => invoke('desk:shop:restartClient', id),
    launchClient: (id) => invoke('desk:shop:launchClient', id),
  },
  engine: {
    start: (id) => invoke('desk:engine:start', id),
    stop: (id) => invoke('desk:engine:stop', id),
    pause: (id) => invoke('desk:engine:pause', id),
    resume: (id) => invoke('desk:engine:resume', id),
    status: () => invoke('desk:engine:status'),
  },
  secrets: {
    set: (name, value) => invoke('desk:secrets:set', { name, value }),
    has: (name) => invoke('desk:secrets:has', name),
  },
  logs: {
    tail: (count) => invoke('desk:logs:tail', count),
  },
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('desk:event', listener);
    return () => ipcRenderer.removeListener('desk:event', listener);
  },
});

