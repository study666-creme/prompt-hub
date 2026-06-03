# 会员与积分领取规则

## 普通用户

- 每日 **5 积分**（任务中心领取，当日有效）
- **300 MB** 云存储（按 `profiles.storage_bytes` 累计，上传成功后登记）

## 轻量会员（lite）

- 包月 ¥6 / 单买 ¥9
- 每日共 **10 积分**（含免费 5 + 额外 5）
- **300 MB + 2 GB** 云存储 · 置顶 **3 张**
- **仅每日领取**，不可选一次性

## 基础 / 标准 / 专业

| 档位 | 包月/单买 | 生图折扣 | 每日额外 | 一次性可选 | 额外卡片库 |
|------|-----------|----------|----------|------------|------------|
| 基础 | ¥12.9 / ¥15.9 | 9 折 | 13 | 130 | — |
| 标准 | ¥31.9 / ¥39.9 | 8 折 | 32 | 320 | **1 个** |
| 专业 | ¥63.9 / ¥69.9 | 7 折 | 64 | 700 | **2 个** |

资产创作：**限免**（登录可用）；AI 对话与生图按积分计费。另建卡片库：**仅标准版 / 专业版**（演示版已做权限提示，数据尚未分库）。

## 任务中心（成长任务 · 20260622d 新增）

| 任务 key | 奖励 | 完成条件 |
|----------|------|----------|
| `extension_save_card` | 3 天基础会员 | 登录浏览器插件并成功 `POST /extension/quick-card` 保存 1 张卡片 |
| `asset_studio_chat` | 1 天基础会员 | 资产创作 AI 对话成功 1 次（服务端记 flag） |
| `asset_studio_link_card` | 2 天基础会员 | 资产创作将卡片拖入文档「关联图」并完成关联（前端 sync） |

领取前须绑定手机号（与现有任务一致）。进度由 `POST /api/v1/membership/tasks/sync` 合并 `membership_task_flags`。

- **同一会员卡密**不区分「每日版 / 一次性版」。
- 兑换前在订阅弹窗 **激活码区域上方** 选择「每日领取」或「一次性领取」，再输入激活码。
- 接口：`POST /api/v1/redeem`，body 带 `creditGrantMode: "daily" | "bundle"`。
- 已开通会员可 `POST /api/v1/membership/credit-mode` 切换（轻量会员不可切 bundle）。

## 扣费顺序

生图：**先扣当日积分，再扣永久积分**；失败退款按原路径退回。

## 迁移（2026-05-29 批次）

按顺序在 Supabase SQL Editor 执行：

1. `20260529140000_community_post_likes.sql`
2. `20260529150000_membership_lite_tier.sql`（停用旧会员卡密）
3. `20260529160000_new_membership_codes_daily.sql`（新码，每档 2 个）

生成更多码：`.\scripts\generate-membership-grant-codes.ps1 -PerProduct 2`

## 部署

```powershell
cd d:\prompt-hub
.\deploy-pages.ps1
cd server
.\deploy.ps1
```

Pages 强刷后确认 `window.__APP_BUILD__` 与 `sw.js` CACHE 已更新。
