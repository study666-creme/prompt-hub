# 🚀 快速开始指南

## 立即使用

### 1. 启动项目（3 秒）

```powershell
cd D:\prompt-hub
.\serve-local.ps1
```

访问：http://127.0.0.1:5500/index.html

### 2. 遇到问题？（1 键修复）

打开：http://127.0.0.1:5500/auto-fix.html

点击：**🛠️ 一键修复**

### 3. 部署上线（1 命令）

```powershell
.\deploy-pages.ps1
```

---

## 🔧 新工具：一键诊断修复

**文件**：`auto-fix.html`

**功能**：
- ✅ 自动检测 6 大问题
- ✅ 一键修复所有问题
- ✅ 刷新图片
- ✅ 修复布局
- ✅ 清除缓存
- ✅ 紧急恢复数据

**使用方法**：

1. 启动本地服务器
2. 打开主页面（index.html）
3. 新标签页打开 auto-fix.html
4. 点击「完整诊断」
5. 点击「一键修复」

**检测项目**：
- 修复补丁是否加载
- 图片加载状态
- 布局是否正常
- 数据完整性
- 云同步状态
- 性能指标

---

## 📋 常用命令

### 控制台命令（F12）

```javascript
// 刷新图片
forceRefreshAllImages()

// 查看恢复点
DataSafety.listRecoveryPoints()

// 创建备份
await DataSafety.createRecoveryPoint('manual')

// 恢复数据
await DataSafety.restoreFromRecoveryPoint(key)

// 健康检查
DataSafety.performHealthCheck()

// 重新布局
layoutMasonryGrid()
```

---

## 🆘 紧急情况

### 图片全部消失

```javascript
forceRefreshAllImages()
```

### 布局完全混乱

```javascript
layoutMasonryGrid()
```

### 数据丢失

```javascript
const points = DataSafety.listRecoveryPoints()
await DataSafety.restoreFromRecoveryPoint(points[0].key)
location.reload()
```

### 一切都不正常

1. 打开 auto-fix.html
2. 点击「🚨 紧急恢复」
3. 确认恢复
4. 刷新页面

---

## 📚 完整文档

- **[HANDOVER.md](HANDOVER.md)** - 完整交接文档（必读）
- **[README.md](README.md)** - 项目说明
- **[SUMMARY.md](SUMMARY.md)** - 工作总结

---

**版本**：v20260606k  
**更新**：2026-06-06
