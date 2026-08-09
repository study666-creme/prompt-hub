import { normalizeImageModelId } from './image-models-catalog';

/** Apimart MJ 模型 upstream 前缀 */
export const MJ_UPSTREAM_PREFIX = 'mj-';

export type MjActionKind =
  | 'upscale'
  | 'variation'
  | 'high_variation'
  | 'low_variation'
  | 'reroll'
  | 'zoom'
  | 'pan'
  | 'inpaint'
  | 'describe'
  | 'blend'
  | 'edits'
  | 'remix_strong'
  | 'remix_subtle'
  | 'video'
  | 'modal';

export const MJ_ACTION_PATH: Record<MjActionKind, string> = {
  upscale: 'upscale',
  variation: 'variation',
  high_variation: 'high-variation',
  low_variation: 'low-variation',
  reroll: 'reroll',
  zoom: 'zoom',
  pan: 'pan',
  inpaint: 'inpaint',
  describe: 'describe',
  blend: 'blend',
  edits: 'edits',
  remix_strong: 'remix-strong',
  remix_subtle: 'remix-subtle',
  video: 'video',
  modal: 'modal'
};

export const MJ_ACTION_LABEL_ZH: Record<MjActionKind, string> = {
  upscale: '放大',
  variation: '变体',
  high_variation: '大幅变体',
  low_variation: '微调变体',
  reroll: '重新生成',
  zoom: '画幅外扩',
  pan: '平移扩图',
  inpaint: '局部重绘',
  describe: '识图',
  blend: '混图',
  edits: '图片编辑',
  remix_strong: '强重塑',
  remix_subtle: '弱重塑',
  video: '基础视频生成',
  modal: '提交遮罩'
};

export type MjButtonPublic = {
  action: MjActionKind | 'custom';
  label: string;
  index?: number;
  customId?: string;
};

export function isMidjourneyUpstream(upstream: string): boolean {
  return String(upstream || '')
    .trim()
    .toLowerCase()
    .startsWith(MJ_UPSTREAM_PREFIX);
}

export function isMidjourneyModelId(modelId: string): boolean {
  const id = normalizeImageModelId(modelId);
  return id.startsWith('mj-');
}

export function localizeMjButtonLabel(raw: string, action?: string, index?: number): string {
  const label = String(raw || '').trim();
  const act = String(action || '').toLowerCase();

  if (/^u(\d)$/i.test(label)) return `放大 ${RegExp.$1}`;
  if (/^v(\d)$/i.test(label)) return `变体 ${RegExp.$1}`;
  if (/upsample|upscale/i.test(label) || act === 'upscale') {
    if (index) return `放大 ${index}`;
    return MJ_ACTION_LABEL_ZH.upscale;
  }
  if (/variation/i.test(label) || act === 'variation') {
    if (index) return `变体 ${index}`;
    return MJ_ACTION_LABEL_ZH.variation;
  }
  if (/reroll|re.?roll/i.test(label) || act === 'reroll') return MJ_ACTION_LABEL_ZH.reroll;
  if (/high.?var/i.test(label) || act === 'high_variation') return MJ_ACTION_LABEL_ZH.high_variation;
  if (/low.?var/i.test(label) || act === 'low_variation') return MJ_ACTION_LABEL_ZH.low_variation;
  if (/zoom/i.test(label) || act === 'zoom') return MJ_ACTION_LABEL_ZH.zoom;
  if (/pan/i.test(label) || act === 'pan') return MJ_ACTION_LABEL_ZH.pan;
  if (/inpaint/i.test(label) || act === 'inpaint') return MJ_ACTION_LABEL_ZH.inpaint;
  if (/describe/i.test(label) || act === 'describe') return MJ_ACTION_LABEL_ZH.describe;
  if (/blend/i.test(label) || act === 'blend') return MJ_ACTION_LABEL_ZH.blend;
  if (/edit/i.test(label) || act === 'edits') return MJ_ACTION_LABEL_ZH.edits;
  if (/remix.?strong/i.test(label) || act === 'remix_strong') return MJ_ACTION_LABEL_ZH.remix_strong;
  if (/remix.?subtle/i.test(label) || act === 'remix_subtle') return MJ_ACTION_LABEL_ZH.remix_subtle;
  if (/video/i.test(label) || act === 'video') return MJ_ACTION_LABEL_ZH.video;

  const known = act as MjActionKind;
  if (known in MJ_ACTION_LABEL_ZH) return MJ_ACTION_LABEL_ZH[known];
  return label || '操作';
}

export function parseMjActionFromCustomId(customId: string): MjActionKind | 'custom' {
  const id = String(customId || '');
  if (/upsample|upscale/i.test(id)) return 'upscale';
  if (/high_variation|high-variation/i.test(id)) return 'high_variation';
  if (/low_variation|low-variation/i.test(id)) return 'low_variation';
  if (/variation/i.test(id)) return 'variation';
  if (/reroll/i.test(id)) return 'reroll';
  if (/zoom/i.test(id)) return 'zoom';
  if (/pan/i.test(id)) return 'pan';
  if (/inpaint/i.test(id)) return 'inpaint';
  if (/describe/i.test(id)) return 'describe';
  if (/blend/i.test(id)) return 'blend';
  if (/edit/i.test(id)) return 'edits';
  if (/remix_strong/i.test(id)) return 'remix_strong';
  if (/remix_subtle/i.test(id)) return 'remix_subtle';
  if (/video/i.test(id)) return 'video';
  return 'custom';
}

function isLikelyMjTileUrl(url: string): boolean {
  return /_[0-3]\.(jpe?g|webp|png)(?:\?|$)/i.test(String(url || ''));
}

function isLikelyMjCompositeUrl(url: string): boolean {
  const u = String(url || '').toLowerCase();
  if (isLikelyMjTileUrl(u)) return false;
  return /grid|composite|四宫|_0_0|\/0_0[./]|\/split\//i.test(u);
}

export function parseMjImagineUrls(
  raw: string[],
  primaryHint?: string | null
): {
  composite: string | null;
  tiles: string[];
  primary: string | null;
  gallery: string[];
} {
  const hint = primaryHint && /^https?:\/\//i.test(primaryHint.trim()) ? primaryHint.trim() : null;
  let urls = [...new Set(raw.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim())).map((u) => u.trim()))];
  if (hint && !urls.includes(hint)) urls = [hint, ...urls];
  if (!urls.length) {
    return { composite: null, tiles: [], primary: null, gallery: [] };
  }
  if (urls.length >= 5) {
    const composite = urls[0];
    const tiles = urls.slice(1, 5);
    const gallery = buildMjGalleryUrls(composite, tiles, composite || tiles[0]);
    return { composite, tiles, primary: composite || tiles[0], gallery };
  }
  if (urls.length === 4) {
    const gridIdx = urls.findIndex(isLikelyMjCompositeUrl);
    if (gridIdx >= 0) {
      const composite = urls[gridIdx];
      const tiles = urls.filter((_, i) => i !== gridIdx).slice(0, 4);
      const gallery = buildMjGalleryUrls(composite, tiles, composite);
      return { composite, tiles, primary: composite || tiles[0], gallery };
    }
    if (hint && !urls.includes(hint)) {
      const gallery = buildMjGalleryUrls(hint, urls, hint);
      return { composite: hint, tiles: urls.slice(0, 4), primary: hint, gallery };
    }
    if (hint && urls.includes(hint)) {
      const tiles = urls.filter((u) => u !== hint).slice(0, 4);
      const gallery = buildMjGalleryUrls(hint, tiles, hint);
      return { composite: hint, tiles, primary: hint, gallery };
    }
    const gallery = buildMjGalleryUrls(null, urls, urls[0]);
    return { composite: null, tiles: urls, primary: urls[0], gallery };
  }
  const gallery = buildMjGalleryUrls(urls[0], urls.slice(1), urls[0]);
  return { composite: urls[0], tiles: urls.slice(1), primary: urls[0], gallery };
}

/** 四宫格合成图 + 最多 4 张单图（与前端 buildMjCardImages 一致） */
export function buildMjGalleryUrls(
  composite: string | null | undefined,
  tiles: string[],
  fallback?: string | null
): string[] {
  const t = (tiles || []).filter(Boolean).slice(0, 4);
  const comp = composite && String(composite).trim();
  if (comp) {
    const rest = t.filter((u) => u !== comp);
    return [comp, ...rest].slice(0, 5);
  }
  if (t.length) return t.slice(0, 5);
  const fb = fallback && String(fallback).trim();
  return fb ? [fb] : [];
}

export function mjGalleryUrlCount(meta: Record<string, unknown>): number {
  const gallery = Array.isArray(meta.mjGalleryUrls)
    ? (meta.mjGalleryUrls as string[]).filter(Boolean)
    : buildMjGalleryUrls(
        typeof meta.mjCompositeUrl === 'string' ? meta.mjCompositeUrl : null,
        Array.isArray(meta.mjGridUrls) ? (meta.mjGridUrls as string[]) : []
      );
  return gallery.length;
}

export function mjPollHasFullGallery(urls: string[]): boolean {
  const parsed = parseMjImagineUrls(urls);
  return parsed.tiles.length >= 4;
}
