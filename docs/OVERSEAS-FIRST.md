# 全国外优先路线（暂不备案 · 小白版）

> **决策（2026-06）**：先在全国外架构上跑产品、验证收入；**暂不办 ICP / EDI / 等保**。  
> 规模上来后再考虑国内合规。本文说明 **现在怎么搭**、**每周备份什么**、**将来怎么迁国内**。

---

## 一、现在固定用什么

| 组件 | 选择 | 说明 |
|------|------|------|
| **主域名** | **`prompt-hubs.com`**（腾讯云注册） | 品牌：Prompt Hub · 提示词管理 / 复用 / 储存 |
| **DNS / CDN** | **Cloudflare**（Free） | Pages + Worker；域名在腾讯云买，**NS 改到 Cloudflare** |
| **静态站** | Cloudflare **Pages** | 项目 `prompt-hub-hub` |
| **API** | Cloudflare **Worker** `prompt-hub-api` | 生图、社区、媒体 CDN |
| **图片** | **Cloudflare R2** | `MEDIA_STORAGE_MODE=r2` · 桶 `prompt-hub-card-images` |
| **数据库** | **境外 Supabase**（目标主库） | 与 R2 同属「全国外数据面」；勿再堆数据到国内 RDS |
| **收费** | 激活码 + 微信 / 淘宝发卡 | **不接**支付宝 / 微信官方支付 |
| **推广** | 小红书 / 抖音 **软广** | 只发干货，作品里不写链接 |

**暂不做：**

- ICP 备案、EDI、等保测评  
- 买 `.cn` / `.com.cn` 当主站  
- 把主库长期放在阿里云 RDS / MemFire（过渡期已有数据可迁回，见下文）  
- 淘宝代购 Supabase **账号密码**；Pro 请自己绑卡或 Stripe 官方链接

**旧域名 `prompt-hub.cn`：** 先别当主入口；DNS 可保留或以后仅跳转。

---

## 二、域名已买：接下来 4 步（腾讯云 → Cloudflare）

### 第 1 步：腾讯云完成实名

腾讯云控制台 → **域名注册 → 我的域名** → `prompt-hubs.com` → 按提示完成 **实名**（`.com` 必需，**不等于网站备案**）。

### 第 2 步：Cloudflare 添加站点

1. 打开 https://dash.cloudflare.com  
2. **Websites → Add a site** → 输入 `prompt-hubs.com` → 选 **Free**  
3. Cloudflare 给出两个 NS，例如 `xxx.ns.cloudflare.com` / `yyy.ns.cloudflare.com`

### 第 3 步：腾讯云改 DNS 服务器

腾讯云 → **我的域名 → prompt-hubs.com → DNS 服务器** → 改成 Cloudflare 的两个 NS（不要继续用 DNSPod 默认 NS）。

等待 **几小时～48 小时**，Cloudflare 显示 **Active**。

### 第 4 步：绑 Pages + Worker

| 用途 | Cloudflare 菜单 | 域名 |
|------|-----------------|------|
| 网站 | **Pages** → 项目 → **Custom domains** | `prompt-hubs.com`（可选 `www`） |
| API | **Workers** → `prompt-hub-api` → **Domains & Routes** | `api.prompt-hubs.com` |

绑完后需改项目配置（见 **`docs/CUSTOM-DOMAIN.md`**、`api-domain.config.js`、Supabase Auth 回调 URL）。改完执行 `.\deploy-pages.ps1` 与 Worker deploy。

---

## 三、每周备份（必做 · 复制即用）

> 完整说明见 **`docs/SUPABASE-BACKUP-BEGINNER.md`**。下面是最小例行。

### 1. 数据库（每周日或发版前）

在 Supabase Dashboard → **Project Settings → Database** 复制连接信息，本机 PowerShell：

```powershell
cd d:\prompt-hub
mkdir backups -Force
$env:PGPASSWORD = "你的数据库密码"
pg_dump -h db.xxxxx.supabase.co -p 5432 -U postgres -d postgres -Fc -f "backups\prompt-hub-$(Get-Date -Format yyyyMMdd).dump"
Remove-Item Env:PGPASSWORD
```

保留最近 **4～8 个** `.dump`；**勿提交 git**。

没有 `pg_dump`：Dashboard → **Database → Backups** 下载，或见备份文档方法 A。

### 2. 站内 JSON 导出（可选 · 双保险）

登录站长账号 → 设置 → **导出备份** → 存到 `backups\json\`。

> JSON **不含**图片像素，只有 `storage://` 引用；不能替代 pg_dump。

### 3. R2 / 图片（每月或有大改动时）

新图已在 R2 时，Cloudflare R2 控制台可开 **版本控制 / 生命周期**；或从 Worker 侧定期跑同步脚本（见 **`docs/R2-MIGRATION.md`**）。

若仍要从旧 Supabase Storage 拉历史图（需 Pro / egress 恢复）：

```powershell
cd d:\prompt-hub
node scripts/sync-supabase-to-r2.mjs --download-only --out backups\card-images
```

### 4. 密钥清单（只存本机，勿提交）

`scripts\admin.local.env`、`server\.dev.vars`、Supabase **service_role**、Worker Secrets 记录在安全处（密码管理器 / 离线笔记）。

---

## 四、将来迁国内：5 步（现在不用做）

满足 **月稳定收入 ≥ 3～5 万** 或 **必须接官方支付 / 企业合同** 再启动。技术路径仓库已备好：

| 步 | 做什么 | 参考文档 |
|----|--------|----------|
| **1** | **pg_dump** 境外库 → **pg_restore** 到 MemFire / 阿里 RDS | `docs/MEMFIRE-MIGRATION.md` |
| **2** | R2 图片 **批量同步** → 国内 OSS / MemFire Storage | `docs/R2-MIGRATION.md` · `scripts/sync-supabase-to-r2.mjs`（反向需自写或 ossutil） |
| **3** | Worker 改 **Secrets**（`SUPABASE_URL`、`MEDIA_STORAGE_MODE` 等）并 deploy | `server/wrangler.toml` |
| **4** | 前端改 `supabase-config.js`、Auth 回调、CORS 域名 | `docs/CUSTOM-DOMAIN.md` |
| **5** | **资质与支付**（ICP → 公司主体 → EDI 等，按当时政策） | 届时单独规划 |

**用户影响（操作规范时）：**

- JWT Secret 一致 → 多数用户 **无需重新登录**  
- 图片路径批量对齐 → 旧图逐步恢复，不必让用户重传  
- 需发 **维护公告**（几小时～1 天），不是让用户从零注册  

**难的部分是资质和商务，不是 dump 本身。**

---

## 五、数据都在哪（防搞混）

| 数据 | 位置 | 备份方式 |
|------|------|----------|
| 用户 / 积分 / 社区 / 卡片 JSON | Postgres | **pg_dump** |
| 图片文件 | R2 | R2 控制台 / 同步脚本 |
| 额外卡片库名 | 部分在浏览器 localStorage | 逐步迁云端；JSON 导出不全 |
| 微信私下订单 | 不在系统里 | 自己表格对账 |

---

## 六、和旧文档的关系

| 文档 | 何时看 |
|------|--------|
| **`OVERSEAS-FIRST.md`（本文）** | **当前主路线** |
| `MEMFIRE-MIGRATION.md` | 将来迁国内库时 |
| `SUPABASE-BACKUP-BEGINNER.md` | 每周备份细节 |
| `R2-MIGRATION.md` | 图片 / R2 模式 |
| `CUSTOM-DOMAIN.md` | 换域名 / 绑 Pages |

---

## 七、检查清单（每月看一眼）

- [ ] 本周有 **pg_dump** 吗？  
- [ ] 主站是否已切到 **`https://prompt-hubs.com`**？  
- [ ] 新用户数据是否进 **境外 Supabase**（而非国内 RDS）？  
- [ ] 图片是否仍走 **R2**（`MEDIA_STORAGE_MODE=r2`）？  
- [ ] 是否仍 **未接** 支付宝 / 微信官方支付？  

---

*更新：2026-06-07 · 主域名 prompt-hubs.com · 暂不备案 · 全国外优先。*
