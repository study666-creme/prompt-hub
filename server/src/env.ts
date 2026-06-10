import type { R2Bucket } from '@cloudflare/workers-types';

export type Env = {
  /** R2 桶绑定：wrangler.toml [[r2_buckets]] CARD_IMAGES_R2 */
  CARD_IMAGES_R2?: R2Bucket;
  /** 图片读写的后端：supabase | r2-first | r2（见 docs/R2-MIGRATION.md） */
  MEDIA_STORAGE_MODE?: string;
  ENVIRONMENT: string;
  CORS_ORIGINS: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET?: string;
  /** 生图上游（GrsAI 等，国内默认 grsai.dakka.com.cn） */
  IMAGE_API_KEY?: string;
  IMAGE_API_BASE_URL?: string;
  /** 生图备用上游 Apimart（GrsAI 提交失败时自动切换） */
  APIMART_API_KEY?: string;
  APIMART_API_BASE_URL?: string;
  /** 生图经济线路 ThinkAI（thinkai.tv 控制台 Token） */
  ITHINK_API_KEY?: string;
  ITHINK_API_BASE_URL?: string;
  /** 可选：覆盖 ThinkAI 上游 model 字段（模型广场里的 ID，默认 gpt-image-2） */
  ITHINK_UPSTREAM_MODEL?: string;
  /** 生图木瓜AI线路（api.mooko.ai 控制台 Token） */
  MOOKO_API_KEY?: string;
  MOOKO_API_BASE_URL?: string;
  /** 木瓜慢速线同时 POST 上限（默认 8，最大 16） */
  MOOKO_MAX_CONCURRENT_SUBMITS?: string;
  /** 对话上游（DeepSeek 官方等，与生图密钥分离） */
  CHAT_API_KEY?: string;
  CHAT_API_BASE_URL?: string;
  CHAT_MODEL?: string;
  /** 反推提示词视觉模型（Apimart 等，默认 gemini-2.5-flash-lite） */
  REVERSE_VISION_MODEL?: string;
  /** 裂变美学 DNA 视觉模型（默认 gemini-2.5-flash，比反推 lite 更懂排版/卡面） */
  FISSION_VISION_MODEL?: string;
  /** 裂变变体策划对话模型（默 deepseek-v4-pro） */
  FISSION_CHAT_MODEL?: string;
  /** 支付 webhook HMAC 密钥：wrangler secret put PAYMENT_WEBHOOK_SECRET */
  PAYMENT_WEBHOOK_SECRET?: string;
  /** 运营批量造激活码：wrangler secret put ADMIN_API_SECRET */
  ADMIN_API_SECRET?: string;
  /** 本地开发：图片走线上 R2/CDN（本地 Miniflare R2 为空时必填，默认 api.prompt-hubs.com） */
  LOCAL_MEDIA_UPSTREAM?: string;
  /** Supabase 文件存储配额（MB），免费版约 1024；未设则默认 1024 */
  SUPABASE_STORAGE_QUOTA_MB?: string;
  /** Supabase 数据库配额（MB），免费版约 500；未设则默认 500 */
  SUPABASE_DB_QUOTA_MB?: string;
  /** 可选：从 Supabase Usage 页手动同步的项目 File Storage 已用（MB） */
  SUPABASE_STORAGE_USED_MB?: string;
  /** 可选：从 Supabase Usage 页手动同步的 Database 已用（MB） */
  SUPABASE_DB_USED_MB?: string;
};

export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === 'production';
}
