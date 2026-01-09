# QuackDrop（项目名）目录说明

> 应用内显示名称仍为 OmniDrop（不影响现有可执行文件命名）。

## 1) 推荐使用方式
- 安装版：`dist/installer/OmniDropSetup.exe`
- 便携版：`dist/app/OmniDrop.exe`
- 仅服务端：`dist/server/OmniDropServer.exe`（面板访问 `http://127.0.0.1:3001`）

## 2) 目录结构
- `dist/app/`：便携版应用与运行时文件
- `dist/installer/`：安装包输出目录
- `dist/server/`：服务端可执行文件与配置
- `panel/`：Electron 面板源码、构建脚本、托盘图标
- `server.js`：服务端入口
- `dashboard.html`：面板前端页面
- `airdrop.png`：图标源文件（托盘/应用图标由此生成）
- `PROJECT_HANDOVER.md`、`OmniDrop_Development_Protocol.md`、`README.md`：项目文档

## 3) 配置文件
- `dist/server/config.json`：服务端配置（`dataDir` 等）
- `dist/app/resources/server/config.json`：便携版默认配置

## 4) 构建脚本（如需）
- `npm run build:server`：输出 `dist/server/OmniDropServer.exe`
- `npm run build:panel`：输出 `dist/app/OmniDrop.exe`
- `npm run build:installer`：输出 `dist/installer/OmniDropSetup.exe`
