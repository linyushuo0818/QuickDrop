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

## iPad 快捷指令
- 配置（扫码）：https://www.icloud.com/shortcuts/bd2fa89066c949d98fc41435b750fe97
- 投送： https://www.icloud.com/shortcuts/4b37869f0c2f4d4fb0d5d5002623f3fc

首次使用流程（配置）
1) 打开 OmniDrop 程序，点击“扫码连接”
2) 在 iPad 上运行“配置”快捷指令扫描二维码
3) 之后即可在各种场景投送内容到 OmniDrop
4) 记得在“投送”快捷指令里勾选“在共享表单中显示”

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

## GitHub 提交建议
不建议提交 `dist/` 和 `node_modules/`。可通过 GitHub Releases 分发安装包。

## 下载说明
建议将安装包发布到 Releases（不是 Packages）：
https://github.com/linyushuo0818/QuickDrop/releases/latest
