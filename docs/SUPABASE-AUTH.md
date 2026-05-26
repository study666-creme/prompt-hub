# 手机号与微信登录配置指南

## 一、手机号验证码登录

### 1. 在 Supabase 开启 Phone

1. 打开 [Supabase Dashboard](https://supabase.com/dashboard) → 你的项目  
2. **Authentication** → **Providers** → **Phone** → 开启  
3. 选择短信服务商并填入密钥（常用 **Twilio**；国内用户也可选支持中国的 SMS 通道）

### 2. 短信服务商说明

| 场景 | 建议 |
|------|------|
| 海外 / 测试 | Twilio（Supabase 文档默认） |
| 中国大陆用户收不到短信 | 需在 Twilio 购买中国通道，或改用支持 +86 的 SMS 网关；纯个人项目可**继续用邮箱登录** |

### 3. 开启网站上的手机登录

编辑 `supabase-config.js`：

```javascript
window.AUTH_PHONE_ENABLED = true;
```

保存并重新部署。登录弹窗会出现 **「手机」** 选项卡。

### 4. 使用方式

1. 登录弹窗 → 选 **手机**  
2. 输入 11 位手机号 → **获取验证码**  
3. 输入短信验证码 → **登录 / 注册**（未注册号码会自动创建账号）

---

## 二、微信登录

微信**没有** Supabase 内置按钮，需要 **微信开放平台** 应用 + 自建 OAuth 中转（Edge Function 或后端）。

### 前置条件

- [微信开放平台](https://open.weixin.qq.com/) 注册开发者  
- 创建 **网站应用**（需审核，通常要有备案域名）  
- 获取 **AppID**、**AppSecret**  
- 配置授权回调域名为你的站点域名  

### 推荐架构

```
用户点击微信登录
  → 你的后端 / Edge Function 跳转微信授权页
  → 微信回调带 code
  → 后端用 code 换 openid，再与 Supabase 用户绑定（自定义 JWT 或 link identity）
  → 重定向回 prompt-hub 并带上 session
```

### 在网站启用微信按钮（配置好后）

编辑 `supabase-config.js`：

```javascript
window.WECHAT_OAUTH_ENABLED = true;
window.WECHAT_OAUTH_URL = 'https://你的域名/api/wechat-login';
```

`WECHAT_OAUTH_URL` 应为你部署的**微信授权入口地址**（点击后 302 到微信）。

未配置时，点击微信会提示阅读本文档。

### 个人开发者务实建议

| 阶段 | 方案 |
|------|------|
| 内测 | **邮箱 + 手机（若短信已通）** 即可 |
| 有公司主体与域名 | 再申请微信开放平台网站应用 |
| 上架 App | 可同时做 **微信开放平台移动应用** + 应用内 SDK |

---

## 三、常见问题

**Q：收不到验证码？**  
检查 Supabase Phone 是否启用、短信余额、手机号是否为 `+86` 格式；开发阶段可先在 Authentication → Users 里手动创建用户。

**Q：邮箱和手机号是同一个账号吗？**  
不是。Supabase 按不同登录方式创建不同用户；同一人的邮箱账号与手机账号数据不自动合并。

**Q：微信登录要多少钱？**  
开放平台认证 300 元/年（以微信官方为准）；Supabase 本身不另收微信费。

---

配置中遇到问题，把 Supabase Authentication 截图与报错原文发来即可排查。
