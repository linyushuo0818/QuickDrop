# OmniDrop Project Handover Documentation

**Date:** 2026-01-08
**Version:** 2.6

## 1. Project Overview
**OmniDrop** is a LAN-based clipboard and file synchronization tool designed to bridge Windows PC and iPad. It allows users to:
1.  **Pull from PC**: iPad fetches the latest clipboard content (Text, Image, URL) or Files from the PC.
2.  **Send to PC**: iPad pushes content to the PC via Shortcuts.
3.  **Dashboard**: A local web interface on the PC to view history and manage settings.

**Core Philosophy:** Simplicity and reliability. We prioritize "Pull" (Shortcuts) over "Push" (Server-initiated) because iPad background listening is unreliable.

## 2. Technical Architecture

### Backend (`server.js`)
-   **Runtime**: Node.js (v18+)
-   **Framework**: Express.js
-   **Key Libraries**:
    -   `multer`: File upload handling.
    -   `qrcode`: Generating connection QR codes.
    -   `node-notifier`: Windows-native notifications.
-   **OS Integration**: Extensive use of **PowerShell** child processes for:
    -   Clipboard manipulation (writing images/text to Windows clipboard).
    -   File system dialogs (Select Folder).
    -   Registry modification (Auto-start).
-   **Storage**:
    -   **Files**: Saved to user-configured directory (Default: `Desktop/OmniDrop_Files`).
    -   **History**: JSON-based storage partitioned by date (`history_YYYY-MM-DD.json`) in `%TEMP%/lan-clipboard`. atomic writes used to prevent corruption.

### Frontend (`dashboard.html`)
-   **Tech Stack**: Vanilla HTML5, CSS3, JavaScript (ES6+). No build tools (React/Vue) required for the frontend itself, serving as a static asset.
-   **Design System**: "NotebookLM" inspired visually.
    -   **Layout**: Responsive Grid (CSS Grid).
    -   **Styling**: Modern, clean, rounded corners (Nested Radius logic), Shadows.
    -   **Hero Section**: Fixed-width (620px) server info block, left-aligned, bold typography.

### Packaging
-   **Tool**: `pkg` (Vercel)
-   **Command**: `pkg . -t node18-win-x64`
-   **Artifact**: `dist/OmniDrop.exe` (Standalone executable, no Node installation required for end users).

### Panel Packaging (Electron)
-   **Tool**: `electron-builder`
-   **Command**: `npm run build:panel` (Requires `dist/OmniDrop.exe` to exist first)
-   **Artifact**: `dist/panel/OmniDropPanel.exe` + `dist/panel/resources` (`npm run build:panel`)
-   **Relationship**: The panel packages the server executable as `resources/server/OmniDrop.exe` so the tray app can start/restart the server.

## 3. Current Feature Set (Implemented)

| Feature | Status | details |
| :--- | :--- | :--- |
| **Unified Upload (`/upload`)** | ✅ | Handles Text, Image, File, URL with unified schema. |
| **Pull Endpoint (`/pull`)** | ✅ | Returns standard JSON for iPad Shortcuts to process. |
| **Dashboard UI** | ✅ | History grid, Copy to Clipboard, Auto-start toggle. |
| **History System** | ✅ | 7-day retention, lazy loading, partitioned storage. |
| **Auto-Start** | ✅ | Modifies `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. |
| **iPad Auto-Config** | ✅ | Endpoint `/config` returns server IP/Port for Shortcuts. |
| **File Transfer** | ✅ | Saves to fixed directory, avoids C: drive clutter. |
| **QR Code** | ✅ | Modal for quick iPad connection. |
| **Push to iPad** | ❌ | **REMOVED**. Decision made to drop server-initiated push due to instability. |

## 4. Development Guidelines & Caveats

### ⚠️ Critical Notes for Future AI Devs
1.  **Do Not Re-add "Push to iPad"**: This requires a persistent server or long-polling on the iPad side, which Shortcuts does not natively support well. Stick to the "Pull" model.
2.  **PowerShell Dependency**: The backend relies heavily on PowerShell. Any changes to clipboard logic must be verified on a real Windows environment (or strictly follow existing patterns).
3.  **UI Alignment**: The Dashboard UI has been "pixel-perfected" based on specific user requests (e.g., Fixed 620px width for IP box). **Do not mess with the alignment** unless explicitly asked.
4.  **Pkg Asset Handling**: When using `pkg`, `__dirname` behaves differently (snapshot file system). `dashboard.html` is served via `res.sendFile(path.join(__dirname, 'dashboard.html'))` which works in `pkg` because it's listed in `package.json` assets.

### Directory Structure
```text
.
├── server.js            # Main entry point & Logic
├── dashboard.html       # Single-file Frontend
├── package.json         # Deps & Pkg config
├── iPad快捷指令...md   # User documentation
└── dist/                # Build output
```

## 5. Next Steps / Unfinished Ideas
*(These are removed from the active roadmap but kept for reference)*
-   **Multi-device Support**: Currently hardcoded for LAN broadcast/unicast logic is simple.
-   **Security**: Currently no auth. Accessible to anyone on LAN. Implementation of a simple PIN/Token auth could be a future task.

## 6. How to Run
1.  **Dev (Server)**: `npm start` (Runs `node server.js`)
2.  **Dev (Panel)**: `npm run start:panel` (Electron shell)
3.  **Build Server**: `npm run build:server` (pkg -> `dist/OmniDrop.exe`)
4.  **Build Panel**: `npm run build:panel` (electron-builder -> `dist/panel`)
5.  **Access**: `http://127.0.0.1:3001` (panel default) or local LAN IP for iPad

## 7. Panel Startup / Params / Troubleshooting

### 启动方式
-   **只启动服务端**: `OmniDrop.exe` 或 `npm start`（默认会尝试拉起 Electron 面板）
-   **只启动面板**: `OmniDropPanel.exe` 或 `npm run start:panel`（面板会确保服务端运行）

### 参数
-   **服务端**: `--panel=none|electron|browser`（默认 `electron`）、`--browser`、`--no-panel`
-   **面板**: `--server-url=http://127.0.0.1:3001`、`--server-path=<path>`、`--port=3001`
-   **环境变量**: `OMNIDROP_PANEL`、`OMNIDROP_SERVER_URL`、`OMNIDROP_SERVER_PATH`、`OMNIDROP_PORT`

### 已知限制
-   面板固定使用 `127.0.0.1` 打开服务；如修改端口必须传 `--server-url` 或 `OMNIDROP_PORT`
-   面板只会停止/重启自己拉起的服务进程；外部启动的服务仅复用
-   目前交付为两个可执行文件（服务端 + 面板）；面板打包依赖先生成 `dist/OmniDrop.exe`
-   若找不到服务端可执行文件，面板会记录日志但不会自动恢复

### 排障方法（日志关键词）
-   服务端面板启动日志：`[panel] mode=...`、`[panel] electron=...`、`[panel] browser=...`
-   启动失败日志：`spawn error`、`spawn exit`、`browser=edge not found`、`browser=chrome not found`
-   面板服务状态日志：`server not ready`、`server start timed out`、`server spawn failed`
