# Prompt Hub 浏览器扩展

在任意网页把用户手动选择的文字和粘贴/拖入的图片保存到 [Prompt Hub](https://prompt-hubs.com) 卡片库。当前版本见 [`manifest.json`](manifest.json)。

## 开发者模式安装

1. Chrome/Edge -> 扩展程序 -> 管理扩展程序。
2. 开启开发者模式，选择“加载已解压的扩展程序”。
3. 选择本目录 `extension/`。
4. 在 <https://prompt-hubs.com> 登录后打开扩展同步会话。
5. 在目标网页点击“在当前页打开面板”。

## 行为

- 划选文字或悬停段落后填入提示词。
- 粘贴/拖入图片并选择标签。
- 页面没有可编辑元素聚焦时，可用 `Ctrl+V` 快捷保存截图。
- 发布到社区必须由用户显式选择，并继续受服务端校验。
- 不自动读取整页 HTML，不记录未保存页面的浏览历史。

## 开发

配置在 `config.js`；认证 bridge 必须使用同一 MemFire auth storage key。API 端点与架构见 [`../docs/BROWSER-EXTENSION.md`](../docs/BROWSER-EXTENSION.md)。

```powershell
cd D:\prompt-hub
.\scripts\package-extension.ps1
```

隐私说明见 [`PRIVACY.md`](PRIVACY.md)，上架流程见 [`../docs/CHROME-WEB-STORE.md`](../docs/CHROME-WEB-STORE.md)。
