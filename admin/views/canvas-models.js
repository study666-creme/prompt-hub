/* 画布模型管理：上架 / 稳定·特惠分区 / 显示名 / 定价（内嵌 Canvas API 覆盖层后台） */

export const title = ['画布模型', '画布侧模型上架、稳定/特惠分区、显示名与定价（改完即生效）'];

const CANVAS_ADMIN_URL = 'https://canvas-api.prompt-hubs.com/admin/model-overrides';

export function init() {}

export function load() {
  const frame = document.getElementById('canvasModelsFrame');
  // 懒加载：第一次切到该板块才载入内嵌后台；之后保留状态不重复刷新。
  if (frame && !frame.src) frame.src = CANVAS_ADMIN_URL;
}
