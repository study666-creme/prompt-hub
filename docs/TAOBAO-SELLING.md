# 淘宝卖积分 · 运营手册

## 一次性配置

1. Supabase 已执行全部 `supabase/migrations/*.sql`（含 `20260526160000_activation_codes_grants.sql`，或单独执行 `scripts/apply-grants-once.sql`）
2. Workers API 已部署：`https://prompt-hub-api.2705367723.workers.dev`
3. 配置管理员密钥（仅做一次）：

```powershell
cd server
npx wrangler secret put ADMIN_API_SECRET
# 输入一串长随机密码，记下来
```

4. 复制 `scripts/admin.local.env.example` → `scripts/admin.local.env`，填入同一密钥
5. 确认 `api-config.js` 中 Pages 域名已指向上述 API（已内置 `prompt-hub-hub.pages.dev`）
6. 推送前端或 ZIP 部署 Pages，让用户访问最新站

> **重要**：`SUPABASE_SERVICE_ROLE_KEY` 必须是 Supabase 控制台 **service_role** 密钥，不能填 `anon` / `publishable` 密钥。

## 引流款：0.1 元 = 100 积分（约 10 张 1K 图）

项目规则：**1 元 = 100 积分**；1K 生图约 **10 积分/张** → 100 积分约 **10 张**（会员折扣另算）。

```powershell
cd d:\prompt-hub\scripts
# 批量备货 30 个（一码一人）
.\generate-codes.ps1 -Count 30 -Credits 100 -Note "taobao-0.1-lead" -Mode Supabase -OutFile ".\taobao-100pts-batch.txt"

# 每出一单再补 1 个（note 写订单号方便对账）
.\generate-codes.ps1 -Count 1 -Credits 100 -Note "tb-订单号" -Mode Supabase
```

离线备选：`.\generate-codes-sql.ps1 -Count 30 -Credits 100` → 到 Supabase SQL Editor 执行。

## 每卖出一单（正价）

```powershell
cd d:\prompt-hub\scripts
# 10 元面值 = 1000 积分，一码一单
.\generate-codes.ps1 -Count 1 -Credits 1000 -Note "淘宝-订单12345" -OutFile ".\last-order.txt"
```

若报错「无法连接到远程服务器」：脚本会**自动改走 Supabase**（需 `server/.dev.vars` 里填好 `sb_secret_` 密钥）。也可强制：

```powershell
.\generate-codes.ps1 -Count 5 -Credits 1000 -Mode Supabase
```

把脚本输出的「淘宝发货文案」复制到旺旺/自动发货。

## 批量备货（20 个 10 元码）

```powershell
.\generate-codes.ps1 -Count 20 -Credits 1000 -Note "淘宝备货20260526" -OutFile ".\codes-batch.csv"
```

## 定价对照

| 售价 | credits 参数 |
|------|----------------|
| 1 元 | 100 |
| 5 元 | 500 |
| 10 元 | 1000 |
| 50 元 | 5000 |

## 不用脚本时（Supabase SQL）

```sql
insert into public.activation_codes (code, credits, max_uses, active, note)
values ('PH-手动订单号', 1000, 1, true, '淘宝-xxx');
```

## 商品页建议文案

- 虚拟商品，付款后发卡密/兑换码
- 需注册 https://prompt-hub-hub.pages.dev 后兑换
- 卡密仅可使用一次，兑换后不退
- 链接《用户协议》《隐私政策》

## 发货文案模板（100 积分）

```
【提示词仓库 · 体验积分】
1. 打开 https://prompt-hub-hub.pages.dev
2. 注册并登录（建议用常用邮箱）
3. 底部「生图」→ 输入激活码 → 兑换
4. 100 积分约可生成 10 张 1K 图（以站内扣费为准）
5. 一码仅用一次，请勿外传

激活码：{CODE}
```

## 注意（防亏、防封、防纠纷）

1. **一单一码**：`max_uses` 默认 1，不要把同一码发给多人。
2. **引流价要限购**：0.1 元极易被刷；淘宝设每人限购、注明「新客/体验」。
3. **生图有成本**：APIMart 按张计费，0.1 元是亏本的，靠后续正价套餐赚回来。
4. **勿泄露备货文件**：`taobao-100pts-batch*.txt` 不要上传网盘公开。
5. **演示码勿作商品**：`PROMPT-HUB-100` 等不要当卡密卖。
6. **对账**：`note` 里写淘宝订单号；Supabase 可查 `used_count=1`。
7. **域名下来后**：把发货链接里的域名换成你的 `api.` 自定义域（访问更稳）。
8. **类目与描述**：选虚拟商品/网络服务类，写清「虚拟积分、兑换后不退」。
