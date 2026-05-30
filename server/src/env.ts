export type Env = {
  ENVIRONMENT: string;
  CORS_ORIGINS: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET?: string;
  /** 生图上游（APIMart 等） */
  IMAGE_API_KEY?: string;
  IMAGE_API_BASE_URL?: string;
  /** 对话上游（DeepSeek 官方等，与生图密钥分离） */
  CHAT_API_KEY?: string;
  CHAT_API_BASE_URL?: string;
  CHAT_MODEL?: string;
  /** 支付 webhook HMAC 密钥：wrangler secret put PAYMENT_WEBHOOK_SECRET */
  PAYMENT_WEBHOOK_SECRET?: string;
  /** 运营批量造激活码：wrangler secret put ADMIN_API_SECRET */
  ADMIN_API_SECRET?: string;
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
