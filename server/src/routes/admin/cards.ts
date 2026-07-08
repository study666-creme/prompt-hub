import { Hono } from 'hono';
import type { Env } from '../../env';
import { formatBytes } from '../../lib/admin-helpers';
import { resolveStoragePath } from '../../lib/media-cdn';
import { cardImageExists } from '../../lib/r2-storage';
import { createAdminClient } from '../../lib/supabase';
import { requireAdminSecret } from '../../middleware/admin';
import { rateLimit } from '../../middleware/rate-limit';

export const adminCardRoutes = new Hono<{ Bindings: Env }>();

adminCardRoutes.use('*', requireAdminSecret);
adminCardRoutes.use('*', rateLimit(80, 60_000));

type CardRisk =
  | 'no-image'
  | 'data-image'
  | 'remote-image'
  | 'owner-mismatch'
  | 'empty-content'
  | 'duplicate-id';

type CardIndexRow = {
  userId: string;
  displayName: string | null;
  cloudUpdatedAt: string | null;
  cardId: string;
  title: string | null;
  promptPreview: string | null;
  image: string | null;
  imageKind: 'storage' | 'remote' | 'data' | 'missing' | 'other';
  imagePath: string | null;
  imageExists?: boolean | null;
  imageChecked?: boolean;
  riskFlags: CardRisk[];
  publishedToCommunity: boolean;
  communityPostId: string | null;
  updatedAt: string | null;
};

type UserCardSummary = {
  userId: string;
  displayName: string | null;
  cards: number;
  noImage: number;
  dataImage: number;
  remoteImage: number;
  storageImage: number;
  ownerMismatch: number;
  emptyContent: number;
  duplicateIds: number;
  cloudUpdatedAt: string | null;
  storageBytes: number;
};

type UserDataRow = {
  user_id: string;
  data: unknown;
  updated_at: string | null;
};

type ProfileRow = {
  user_id: string;
  display_name?: string | null;
  storage_bytes?: number | string | null;
};

const MAX_USER_DATA_ROWS = 2500;
const CARD_INDEX_CACHE_TTL_MS = 20_000;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function shortText(v: unknown, max = 96): string | null {
  const s = asString(v);
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function parseCardTime(card: Record<string, unknown>, fallback: string | null): string | null {
  const raw =
    card.updatedAt ?? card.updateAt ?? card.createdAt ?? card.created_at ?? card.time ?? card.timestamp;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = raw < 10_000_000_000 ? raw * 1000 : raw;
    const d = new Date(n);
    return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
  }
  if (typeof raw === 'string' && raw.trim()) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
  }
  return fallback;
}

function classifyImage(userId: string, image: string | null) {
  if (!image) {
    return {
      imageKind: 'missing' as const,
      imagePath: null,
      riskFlags: ['no-image'] as CardRisk[]
    };
  }

  const path = resolveStoragePath(image);
  if (path) {
    const ownerMismatch = !path.startsWith(`${userId}/`);
    return {
      imageKind: 'storage' as const,
      imagePath: path,
      riskFlags: ownerMismatch ? (['owner-mismatch'] as CardRisk[]) : []
    };
  }

  if (/^data:image\//i.test(image)) {
    return {
      imageKind: 'data' as const,
      imagePath: null,
      riskFlags: ['data-image'] as CardRisk[]
    };
  }

  if (/^https?:\/\//i.test(image)) {
    return {
      imageKind: 'remote' as const,
      imagePath: null,
      riskFlags: ['remote-image'] as CardRisk[]
    };
  }

  return {
    imageKind: 'other' as const,
    imagePath: null,
    riskFlags: [] as CardRisk[]
  };
}

function cardMatchesQuery(row: CardIndexRow, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [
    row.userId,
    row.displayName || '',
    row.cardId,
    row.title || '',
    row.promptPreview || '',
    row.image || '',
    row.imagePath || '',
    row.communityPostId || ''
  ].some((v) => String(v).toLowerCase().includes(needle));
}

function cardMatchesRisk(row: CardIndexRow, risk: string) {
  if (!risk || risk === 'all') return true;
  return row.riskFlags.includes(risk as CardRisk);
}

async function loadProfiles(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Map<string, ProfileRow>> {
  if (!userIds.length) return new Map();
  const out = new Map<string, ProfileRow>();
  for (let i = 0; i < userIds.length; i += 200) {
    const chunk = userIds.slice(i, i + 200);
    const { data, error } = await admin
      .from('profiles')
      .select('user_id, display_name, storage_bytes')
      .in('user_id', chunk);
    if (error) throw error;
    for (const row of (data ?? []) as ProfileRow[]) out.set(row.user_id, row);
  }
  return out;
}

async function loadCardIndexFresh(admin: ReturnType<typeof createAdminClient>) {
  const { data, error, count } = await admin
    .from('user_data')
    .select('user_id,data,updated_at', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(0, MAX_USER_DATA_ROWS - 1);
  if (error) throw error;

  const rows = (data ?? []) as UserDataRow[];
  const profiles = await loadProfiles(
    admin,
    rows.map((row) => row.user_id).filter(Boolean)
  );
  const cards: CardIndexRow[] = [];
  const users = new Map<string, UserCardSummary>();
  const totals = {
    userDataRows: count ?? rows.length,
    scannedUserDataRows: rows.length,
    truncated: (count ?? rows.length) > rows.length,
    usersWithCards: 0,
    totalCards: 0,
    storageImages: 0,
    remoteImages: 0,
    dataImages: 0,
    noImage: 0,
    ownerMismatch: 0,
    emptyContent: 0,
    duplicateIds: 0,
    publishedToCommunity: 0,
    communityLinked: 0,
    payloadBytesApprox: 0
  };

  for (const row of rows) {
    const payload = asObject(row.data);
    const rawCards = Array.isArray(payload.cards) ? payload.cards : [];
    const profile = profiles.get(row.user_id);
    const displayName = profile?.display_name || null;
    const summary: UserCardSummary = {
      userId: row.user_id,
      displayName,
      cards: 0,
      noImage: 0,
      dataImage: 0,
      remoteImage: 0,
      storageImage: 0,
      ownerMismatch: 0,
      emptyContent: 0,
      duplicateIds: 0,
      cloudUpdatedAt: row.updated_at,
      storageBytes: Number(profile?.storage_bytes) || 0
    };
    const seenCardIds = new Set<string>();
    try {
      totals.payloadBytesApprox += new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    } catch {
      /* ignore approximate size failure */
    }

    for (const raw of rawCards) {
      const card = asObject(raw);
      const id =
        asString(card.id)
        || asString(card.cardId)
        || `unknown-${row.user_id}-${summary.cards + 1}`;
      const image = asString(card.image);
      const title = shortText(card.title ?? card.name, 80);
      const promptPreview = shortText(card.prompt ?? card.content ?? card.text, 140);
      const imageMeta = classifyImage(row.user_id, image);
      const riskFlags = [...imageMeta.riskFlags];
      const emptyContent = !title && !promptPreview;
      const duplicate = seenCardIds.has(id);
      seenCardIds.add(id);
      if (emptyContent) riskFlags.push('empty-content');
      if (duplicate) riskFlags.push('duplicate-id');

      const publishedToCommunity =
        card.publishedToCommunity === true || card.isPublished === true || card.public === true;
      const communityPostId = asString(card.communityPostId ?? card.postId);

      const item: CardIndexRow = {
        userId: row.user_id,
        displayName,
        cloudUpdatedAt: row.updated_at,
        cardId: id,
        title,
        promptPreview,
        image,
        imageKind: imageMeta.imageKind,
        imagePath: imageMeta.imagePath,
        riskFlags,
        publishedToCommunity,
        communityPostId,
        updatedAt: parseCardTime(card, row.updated_at)
      };
      cards.push(item);

      summary.cards += 1;
      totals.totalCards += 1;
      if (item.imageKind === 'storage') {
        summary.storageImage += 1;
        totals.storageImages += 1;
      } else if (item.imageKind === 'remote') {
        summary.remoteImage += 1;
        totals.remoteImages += 1;
      } else if (item.imageKind === 'data') {
        summary.dataImage += 1;
        totals.dataImages += 1;
      } else if (item.imageKind === 'missing') {
        summary.noImage += 1;
        totals.noImage += 1;
      }
      if (riskFlags.includes('owner-mismatch')) {
        summary.ownerMismatch += 1;
        totals.ownerMismatch += 1;
      }
      if (riskFlags.includes('empty-content')) {
        summary.emptyContent += 1;
        totals.emptyContent += 1;
      }
      if (riskFlags.includes('duplicate-id')) {
        summary.duplicateIds += 1;
        totals.duplicateIds += 1;
      }
      if (publishedToCommunity) totals.publishedToCommunity += 1;
      if (communityPostId) totals.communityLinked += 1;
    }

    if (summary.cards > 0) {
      totals.usersWithCards += 1;
      users.set(row.user_id, summary);
    }
  }

  cards.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  return {
    cards,
    users: [...users.values()],
    totals: {
      ...totals,
      payloadApproxLabel: formatBytes(totals.payloadBytesApprox)
    }
  };
}

type CardIndex = Awaited<ReturnType<typeof loadCardIndexFresh>>;

let cardIndexCache: { at: number; value: CardIndex } | null = null;
let cardIndexInflight: Promise<CardIndex> | null = null;

async function loadCardIndex(
  admin: ReturnType<typeof createAdminClient>,
  opts: { refresh?: boolean } = {}
): Promise<CardIndex> {
  const now = Date.now();
  if (!opts.refresh && cardIndexCache && now - cardIndexCache.at < CARD_INDEX_CACHE_TTL_MS) {
    return cardIndexCache.value;
  }
  if (cardIndexInflight) return cardIndexInflight;

  cardIndexInflight = loadCardIndexFresh(admin)
    .then((value) => {
      cardIndexCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      cardIndexInflight = null;
    });
  return cardIndexInflight;
}

async function checkPageImages(
  env: Env,
  admin: ReturnType<typeof createAdminClient>,
  items: CardIndexRow[]
) {
  let idx = 0;
  const checkable = items.filter((item) => item.imagePath);
  async function worker() {
    while (idx < checkable.length) {
      const item = checkable[idx];
      idx += 1;
      try {
        item.imageExists = item.imagePath
          ? await cardImageExists(env, item.imagePath, admin)
          : null;
      } catch {
        item.imageExists = null;
      }
      item.imageChecked = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, checkable.length || 1) }, () => worker()));
}

adminCardRoutes.get('/summary', async c => {
  const admin = createAdminClient(c.env);
  const index = await loadCardIndex(admin, { refresh: c.req.query('refresh') === '1' });
  const topUsers = [...index.users]
    .sort((a, b) => b.cards - a.cards)
    .slice(0, 12)
    .map((u) => ({
      ...u,
      storageLabel: formatBytes(u.storageBytes)
    }));
  const riskUsers = [...index.users]
    .filter((u) => u.noImage || u.dataImage || u.remoteImage || u.ownerMismatch || u.emptyContent || u.duplicateIds)
    .sort(
      (a, b) =>
        b.ownerMismatch + b.dataImage + b.remoteImage + b.noImage + b.emptyContent + b.duplicateIds
        - (a.ownerMismatch + a.dataImage + a.remoteImage + a.noImage + a.emptyContent + a.duplicateIds)
    )
    .slice(0, 12)
    .map((u) => ({
      ...u,
      storageLabel: formatBytes(u.storageBytes)
    }));
  const recentUsers = [...index.users]
    .sort((a, b) => String(b.cloudUpdatedAt || '').localeCompare(String(a.cloudUpdatedAt || '')))
    .slice(0, 8)
    .map((u) => ({ ...u, storageLabel: formatBytes(u.storageBytes) }));

  return c.json({
    ok: true,
    data: {
      ...index.totals,
      topUsers,
      riskUsers,
      recentUsers
    }
  });
});

adminCardRoutes.get('/', async c => {
  const limit = Math.min(80, Math.max(1, Number(c.req.query('limit')) || 30));
  const offset = Math.max(0, Number(c.req.query('offset')) || 0);
  const q = String(c.req.query('q') || '').trim();
  const risk = String(c.req.query('risk') || 'all').trim();
  const checkImages = c.req.query('checkImages') === '1';
  const admin = createAdminClient(c.env);
  const index = await loadCardIndex(admin, { refresh: c.req.query('refresh') === '1' });
  const filtered = index.cards.filter((row) => cardMatchesQuery(row, q) && cardMatchesRisk(row, risk));
  const items = filtered.slice(offset, offset + limit);
  if (checkImages) await checkPageImages(c.env, admin, items);

  return c.json({
    ok: true,
    data: {
      items,
      total: filtered.length,
      limit,
      offset,
      scannedCards: index.cards.length,
      checkImages
    }
  });
});
