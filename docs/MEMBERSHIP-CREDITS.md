# 会员与积分领取规则

## 免费试用（3 天）

- 每人 **1 次**，需 **绑定并验证手机号**（Supabase Phone Auth）。
- 试用期内 **每日 10 积分**，**当日有效**，不累计到次日。
- 接口：`POST /api/v1/membership/trial-free`

## ¥1.9 续杯（14 天基础会员）

- 用于筛选真实付费用户，非 14 天免费试用。
- 淘宝发货激活码示例：`STARTER-19-14D`（`offer_kind = starter_14d`，14 天 `basic`）。
- 兑换前在订阅页选择积分领取方式（见下）。
- 使用后 `first_sub_offer_used = true`。

## 正式会员：积分二选一

| 方式 | 说明 |
|------|------|
| **每日积分** | 每天 10 积分，当天不用作废 |
| **一次性积分** | 基础 100 / 标准 310 / 专业 1000，入账后 **永久有效** 直至用完 |

- 订阅弹窗内单选项切换；已开通会员可 `POST /api/v1/membership/credit-mode`。
- 兑换会员激活码时传 `creditGrantMode: "daily" | "bundle"`（前端随订阅页选择带上）。

## 扣费顺序

生图扣费时：**先扣当日积分，再扣永久积分**；失败退款按原路径退回。

## 部署

1. Supabase 执行 `supabase/migrations/20260526210000_membership_credit_modes.sql`
2. `cd server && npm run deploy`
3. Pages 强刷（`sw.js` v41+）

## 手机绑定

在 Supabase Dashboard → Authentication → Providers 启用 **Phone**，用户验证后 `phone_confirmed_at` 非空方可领试用。
