/** Bounded, data-only Figma handoff. Imported JSON is never executed. */
export const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const safeText = (value, max = 300) => typeof value === 'string' ? value.slice(0, max) : '';
function normalizePath(path) {
  if (!Array.isArray(path)) return [];
  return path.slice(0, 32).map(item => ({
    id: safeText(item?.id, 160),
    name: safeText(item?.name, 300),
    type: safeText(item?.type, 40)
  }));
}
export function parseSnapshot(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES) {
    throw new Error('快照不得超过 20 MB');
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('不是有效的 JSON 文件'); }
  if (!data || data.schema !== 'lingtu.design-snapshot' || ![1, 2].includes(data.version)) {
    throw new Error('需要灵兔本地设计快照 v1/v2，不支持直接导入 .fig');
  }
  if (!Array.isArray(data.nodes) || data.nodes.length < 1 || data.nodes.length > 20) {
    throw new Error('每个快照需要 1–20 个画板');
  }
  const ids = new Set();
  const nodes = data.nodes.map(node => {
    if (!node || typeof node.id !== 'string' || !/^[\w:;-]{1,160}$/.test(node.id) ||
        typeof node.name !== 'string' || node.name.length > 300) {
      throw new Error('画板 ID 或名称无效');
    }
    if (ids.has(node.id)) throw new Error('快照包含重复的画板 ID');
    ids.add(node.id);
    if (!Number.isFinite(node.width) || !Number.isFinite(node.height) ||
        node.width <= 0 || node.height <= 0 || node.width > 50000 || node.height > 50000) {
      throw new Error('画板尺寸超出范围');
    }
    if (node.preview && (typeof node.preview !== 'string' ||
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(node.preview))) {
      throw new Error('预览仅允许内嵌 PNG');
    }
    if (!isRecord(node.document || {})) throw new Error('图层结构无效');
    if (!isRecord(node.components || {}) || !isRecord(node.styles || {})) {
      throw new Error('组件或样式引用结构无效');
    }
    if (Object.keys(node.components || {}).length > 5000 || Object.keys(node.styles || {}).length > 5000) {
      throw new Error('组件或样式引用数量超出限制');
    }
    const absoluteBounds = isRecord(node.absoluteBounds) &&
      ['x', 'y', 'width', 'height'].every(key => Number.isFinite(node.absoluteBounds[key]))
      ? { x: node.absoluteBounds.x, y: node.absoluteBounds.y, width: node.absoluteBounds.width, height: node.absoluteBounds.height }
      : null;
    return {
      id: node.id,
      name: node.name,
      type: safeText(node.type, 40) || 'UNKNOWN',
      width: node.width,
      height: node.height,
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
      absoluteBounds,
      path: normalizePath(node.path),
      preview: node.preview || '',
      document: node.document || {},
      components: node.components || {},
      styles: node.styles || {},
      schemaVersion: typeof node.schemaVersion === 'string' || typeof node.schemaVersion === 'number' ? node.schemaVersion : null,
      warning: safeText(node.warning, 1000)
    };
  });
  return {
    schema: 'lingtu.design-snapshot',
    version: data.version,
    fileName: safeText(data.fileName) || '未命名文件',
    pageId: safeText(data.pageId, 160),
    pageName: safeText(data.pageName),
    exportedAt: safeText(data.exportedAt, 100),
    source: safeText(data.source, 100) || 'legacy-v1',
    nodes
  };
}
