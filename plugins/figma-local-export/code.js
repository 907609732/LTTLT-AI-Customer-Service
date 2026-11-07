/* Read-only local design export. No network calls, tokens, or document writes. */
figma.showUI(__html__, { width: 440, height: 500, themeColors: true });
let busy = false;
function getPath(node) {
  const path = [];
  let parent = node.parent;
  while (parent && parent.type !== 'DOCUMENT') {
    path.push({ id: parent.id, name: parent.name, type: parent.type });
    parent = parent.parent;
  }
  return path.reverse();
}
function selectionStatus() {
  figma.ui.postMessage({
    type: 'selection',
    fileName: figma.root.name,
    pageName: figma.currentPage.name,
    items: figma.currentPage.selection.map(node => ({
      id: node.id, name: node.name, type: node.type,
      width: node.width, height: node.height
    }))
  });
}
figma.on('selectionchange', selectionStatus);
selectionStatus();
figma.ui.onmessage = async message => {
  if (!message || message.type !== 'export' || busy) return;
  busy = true;
  try {
    const nodes = figma.currentPage.selection.slice();
    if (nodes.length < 1 || nodes.length > 20) {
      throw new Error('请选中 1–20 个正式画板。建议按 UX 编号分批导出。');
    }
    if (nodes.some(node => !['FRAME', 'COMPONENT', 'INSTANCE', 'COMPONENT_SET', 'GROUP'].includes(node.type))) {
      throw new Error('请选择可编辑的 Frame / Component / Instance / Component Set，不要只选图片或文本。');
    }
    const snapshot = {
      schema: 'lingtu.design-snapshot',
      version: 2,
      fileName: figma.root.name,
      pageId: figma.currentPage.id,
      pageName: figma.currentPage.name,
      exportedAt: new Date().toISOString(),
      source: 'figma-classic-plugin-api',
      nodes: []
    };
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      figma.ui.postMessage({
        type: 'progress',
        text: '正在读取可编辑图层 ' + (index + 1) + ' / ' + nodes.length + '：' + node.name
      });
      const rest = await node.exportAsync({ format: 'JSON_REST_V1' });
      let preview = '';
      let warning = '';
      if (message.includePreview !== false) {
        try {
          const scale = Math.min(1, 1920 / Math.max(node.width, 1), 1920 / Math.max(node.height, 1));
          const png = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
          preview = 'data:image/png;base64,' + figma.base64Encode(png);
        } catch (error) {
          warning = 'PNG 预览失败，但图层结构已保留：' + String(error);
        }
      }
      const bounds = node.absoluteBoundingBox || null;
      snapshot.nodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        width: node.width,
        height: node.height,
        x: node.x,
        y: node.y,
        absoluteBounds: bounds ? {
          x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height
        } : null,
        path: getPath(node),
        document: rest.document || rest,
        components: rest.components || {},
        styles: rest.styles || {},
        schemaVersion: rest.schemaVersion || null,
        preview,
        warning
      });
    }
    figma.ui.postMessage({ type: 'result', snapshot });
  } catch (error) {
    figma.ui.postMessage({ type: 'error', text: String(error && error.message || error) });
  } finally {
    busy = false;
  }
};
