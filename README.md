# OmniDrop

OmniDrop 是一个局域网投递工具，用于在 iPad 与 Windows 之间传输文本、图片和文件，并提供桌面常驻面板。

## 当前版本
- `v1.4.0`

## 功能概览
- iPad -> Windows：投递文本、图片、文件
- Windows 侧：写入剪贴板、保存文件、历史记录
- 仪表盘：扫码连接、开机自启、目录管理、历史记录面板
- 后端接口：`/health`、`/status`、`/history`、`/upload`、`/qrcode` 等

## 快速使用
- 安装依赖：`npm install`
- 启动服务：`npm run start`
- 打开仪表盘：`http://127.0.0.1:3001`

## 构建命令
```bash
npm run build:server
npm run build:panel
npm run build:installer
```

## iPad 快捷指令
- 配置（扫码）：`https://www.icloud.com/shortcuts/bd2fa89066c949d98fc41435b750fe97`
- 投送：`https://www.icloud.com/shortcuts/4b37869f0c2f4d4fb0d5d5002623f3fc`

## 配置路径
- 服务端配置：`dist/server/config.json`
- 面板配置：`dist/app/resources/server/config.json`

## 本次改动（v1.4.0，2026-02-12）
- **仪表盘 UI 完整重构**：参考 Anthropic 风格，三段式信息架构
  - 极简顶栏：品牌字号缩小、新增主题切换按钮
  - 连接信息条：IP + 保存路径合并为一行；hover IP 时浮出 QR 码气泡
  - 收件箱为视觉重心：4 列卡片网格，卡片仅保留删除操作
- **暗色模式**：支持系统自动检测 + 手动切换（localStorage 持久化）
- 色板：暖灰 `#ede9e0` 底 + 深墨 `#1b1a18` 文字 + 暖橘 `#d97c5d` 少量点缀
- 字体：Fraunces（标题） + Manrope（正文）

## 历史改动（v1.3.2，2026-02-11）
- 结构重构：顶栏改为 `OmniDrop + 呼吸状态点 + 设置齿轮`
- QR 成为视觉重心：主页直接展示圆角二维码
- 路径语义化：不再直接暴露 `E:\\...` 原始路径
- 后端新增：`DELETE /history/:id`，支持删除单条历史记录
- 卡片微操作：新增右下角悬浮操作栏（复制 / 打开 / 删除）

## 自启配置
- 已配置当前用户登录后自动拉起 OmniDrop（`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\OmniDrop`）

## 已知注意事项
- 若启动时报 `EADDRINUSE: 3001`，说明已有 OmniDrop 进程占用端口，需先结束旧进程
- 默认无鉴权，仅建议在可信局域网中使用
