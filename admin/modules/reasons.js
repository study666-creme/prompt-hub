/* 积分流水 reason 的中文标签 + 可选原因全集。
 * 后台筛选与列表统一走这里，避免直接显示英文枚举；下拉不再依赖服务端那份
 * 与实际数据对不上的 REASONS（旧列表里的 generation_charge / generation_refund
 * 从未落库，选了必然查不到）。 */

export const REASON_LABELS = {
  // 消费
  image_generation: '生图消费',
  video_generation: '视频生成消费',
  chat_generation: '对话消费',
  prompt_optimize: '提示词优化',
  prompt_fission: '提示词裂变',
  prompt_reverse: '提示词反推',
  prompt_purify_describe: '提示词净化/描述',
  // 退款与冲正
  image_generation_refund: '生图退款',
  video_generation_refund: '视频生成退款',
  chat_generation_refund: '对话退款',
  video_undercharge_adjust: '视频少扣追回',
  duration_adjustment: '时长差异调整',
  // 充值 / 发放
  payment_topup: '充值到账',
  settle_topup: '结算充值',
  subscription_grant: '会员发放',
  activation_code: '激活码兑换',
  redemption: '兑换码',
  daily_grant: '每日赠送',
  daily_checkin: '每日签到',
  checkin_streak_bonus: '连签奖励',
  invite_reward: '邀请奖励',
  milestone_reward: '里程碑奖励',
  grant_canvas_create_node_reward: '画布建节点奖励',
  admin_manual: '管理员手动调整',
  // 系统
  daily_expire: '每日积分过期',
  isolated_paid_image_ui_acceptance: '付费生图验收（隔离）',
  isolated_paid_image_canary: '付费生图灰度（隔离）'
};

/** 下拉原因的基准顺序（按运营查看频率）。 */
export const KNOWN_REASONS = [
  'image_generation',
  'image_generation_refund',
  'video_generation',
  'video_generation_refund',
  'video_undercharge_adjust',
  'duration_adjustment',
  'chat_generation',
  'chat_generation_refund',
  'prompt_optimize',
  'prompt_fission',
  'prompt_reverse',
  'prompt_purify_describe',
  'payment_topup',
  'settle_topup',
  'subscription_grant',
  'activation_code',
  'redemption',
  'daily_grant',
  'daily_checkin',
  'checkin_streak_bonus',
  'daily_expire',
  'admin_manual',
  'milestone_reward',
  'invite_reward',
  'grant_canvas_create_node_reward',
  'isolated_paid_image_ui_acceptance',
  'isolated_paid_image_canary'
];

/** 列表里用的短标签：认识就显示中文，不认识原样返回英文枚举。 */
export function reasonLabel(code) {
  const key = String(code || '');
  if (!key) return '—';
  return REASON_LABELS[key] || key;
}

/** 下拉筛选用：中文在前、英文枚举带括号，方便运营对照。 */
export function reasonOptionLabel(code) {
  const key = String(code || '');
  if (!key) return '全部原因';
  const label = REASON_LABELS[key];
  return label ? `${label}（${key}）` : key;
}

/**
 * 合并服务端返回的原因列表：以本地全集为底，再补上服务端/历史数据里出现的
 * 新枚举，保证「实际有数据的 reason 一定能筛」。
 */
export function mergeReasonOptions(serverReasons) {
  const merged = [...KNOWN_REASONS];
  const seen = new Set(merged);
  for (const value of Array.isArray(serverReasons) ? serverReasons : []) {
    const key = String(value || '');
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(key);
    }
  }
  return merged;
}
