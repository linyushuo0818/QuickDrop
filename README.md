# QuackDrop

这是一个局域网投递工具（应用内显示 OmniDrop），用于在 iPad 与 Windows 之间传输文本、图片、文件，并在桌面提供独立面板与托盘常驻能力。

## 功能概览
- iPad → Windows：文本、图片、文件投递
- Windows 侧：自动写入剪贴板 + 托盘常驻
- 独立面板（Electron）加载内置仪表盘
- 支持开机自启、路径管理、历史记录

## 快速使用（推荐）
- 安装版：`dist/installer/OmniDropSetup.exe`
- 便携版：`dist/app/OmniDrop.exe`
- 仅服务端：`dist/server/OmniDropServer.exe`（面板访问 `http://127.0.0.1:3001`）

## 开发与构建
```bash
npm install
npm run build:server
npm run build:panel
npm run build:installer
```

## 配置
- 保存目录等配置位于：
  - `dist/server/config.json`
  - `dist/app/resources/server/config.json`
- 面板内“更改路径”会更新配置并影响“打开文件夹”

## 安全提示
当前版本默认无鉴权，建议在可信局域网内使用。

## 代码来源说明
代码由 Gemini、Claude、GPT 生成，出现屎山代码属于正常现象。


