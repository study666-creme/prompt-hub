# Chrome / Edge 扩展上架

## 提交材料

| 材料 | 仓库位置 |
|---|---|
| 扩展源码 | `extension/` |
| 商店文案 | `extension/STORE-LISTING.zh-CN.txt` |
| 扩展隐私说明 | `extension/PRIVACY.md` |
| 公开隐私 URL | <https://prompt-hubs.com/privacy.html> |
| 打包脚本 | `scripts/package-extension.ps1` |

商店截图和开发者账号必须由所有者在官方控制台完成。费用、尺寸和审核时长以 Chrome Web Store / Microsoft Partner Center 当期要求为准。

## 上架前

1. `manifest.json` 版本递增，描述和主域名使用 `prompt-hubs.com`。
2. 重新加载扩展，验证登录同步、token 刷新、文字/图片存卡和退出。
3. 运行打包脚本并解压检查内容。
4. 浏览器打开隐私 URL，确认 200 且包含扩展权限和数据处理说明。
5. 截图只使用测试数据，不暴露邮箱、UUID、卡密或个人卡片。

## 打包

```powershell
cd D:\prompt-hub
.\scripts\package-extension.ps1
```

## 权限说明

| 权限 | 原因 |
|---|---|
| `storage` | 本地保存登录会话和面板设置 |
| `scripting` | 用户主动打开时注入存卡面板 |
| 主站/API host permissions | 同步登录并通过 HTTPS 保存卡片 |
| optional `<all_urls>` | 仅在用户选择的网页显示面板 |

Single purpose 建议：保存用户手动选择的文字和图片到其 Prompt Hub 账号，不自动抓取网页或浏览历史。

## 提交流程

1. 在 Chrome Web Store Developer Dashboard 创建 item，上传 zip。
2. 使用仓库商店文案，分类选择 Productivity。
3. 填写权限理由、Single purpose、隐私政策 URL、主页和支持 URL。
4. 先用 Unlisted 做小范围验证，再按运营决定是否 Public。
5. Edge 可复用同一 Manifest V3 zip，但需单独在 Partner Center 提交。

审核拒绝时按具体条款修权限或文案，不通过增加无关权限绕过审核。
