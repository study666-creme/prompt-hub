# 激活码运营手册

> 激活码、订单和客户信息属于敏感运营数据，只保存在本地或后台，不提交 Git。

## 一次性配置

1. Worker Secret 已设置 `ADMIN_API_SECRET`。
2. 复制 `scripts/admin.local.env.example` 为被忽略的 `scripts/admin.local.env`。
3. 设置：

```dotenv
API_BASE_URL=https://api.prompt-hubs.com
ADMIN_API_SECRET=<same-as-worker-secret>
```

4. 后台 <https://prompt-hubs.com/admin.html> 可以查询卡密和兑换记录。

## 生成积分码

推荐走 Worker 管理接口：

```powershell
cd D:\prompt-hub\scripts
.\generate-codes.ps1 -Count 1 -Credits 1000 -Note 'order-<id>' -Mode Api
```

批量生成时使用唯一订单/批次 note，并将输出写到 Git 忽略目录：

```powershell
.\generate-codes.ps1 -Count 20 -Credits 1000 -Note 'batch-YYYYMMDD' -Mode Api -OutFile '..\backups\codes-YYYYMMDD.txt'
```

`-Mode Supabase` 会使用 service role 直写数据库，只作为 Worker 不可用时的维护回退，不是日常首选。

## 商品对应

前端当前积分包：100、500、1000、3000、5000、10000 积分。实际价格和赠送会员天数以 `subscription.js` 为准；批量备货可使用 `scripts/generate-shop-codes.ps1`，执行前先核对脚本产品表。

## 每单流程

1. 生成一码一人、`max_uses=1` 的新码。
2. note 写订单号或不可逆内部编号，不写客户敏感信息。
3. 发给用户主站 <https://prompt-hubs.com> 和兑换路径。
4. 用户登录后在积分/会员面板兑换。
5. 后台核对 `used_count`、兑换用户和积分流水。

## 发货模板

```text
Prompt Hub 激活码
1. 打开 https://prompt-hubs.com
2. 注册或登录
3. 打开积分/会员面板，输入激活码
4. 余额和具体模型消耗以页面实时报价为准

激活码：{CODE}
```

## 风险控制

- 不重复发同一码，不在聊天群/公开仓库上传备货文件。
- 不承诺固定生成张数；模型价格、分辨率和会员折扣会影响消耗。
- 退款、虚拟商品和个人信息处理应遵守销售平台与所在地法规。
- 上游余额、生成失败率和异常兑换量每日从运营后台查看。
- 发现卡密泄露时先停用未兑换码，再查后台记录，不删除审计流水。
