# OmniDrop 开发与协作协议 (Development Protocols)

这份文档提炼了我们在开发 OmniDrop 过程中总结的技术决策、踩坑经验和最佳协作流程。旨在为未来的代码维护和新功能开发提供“默认基准”。

---

## 1. 技术架构基准 (Tech Stack Baseline)

*   **核心运行时**: Node.js (Express)
*   **发布形式**: `pkg` 打包为单文件可执行程序 (`node18-win-x64`)
*   **系统交互层**: **PowerShell**
    *   我们不引入 C# 或 C++ 原生模块，所有 Windows API 调用（通知、注册表、弹窗）均通过 `child_process.exec('powershell ...')` 实现。
    *   **原则**: PowerShell 脚本应尽量短小，尽量不依赖外部 `.ps1` 文件（除非逻辑极复杂），直接拼接字符串执行以减少打包路径问题。

---

## 2. 核心开发原则 (Core Principles)

### 🛑 GUI 交互的降级策略 (Graceful Degradation)
*   **背景**: 在后台 Node 进程（尤其是打包后的 exe）中调用 Windows 桌面 GUI（如 WinForms 对话框）极其不稳定，容易受 Session 隔离影响。
*   **协议**:
    1.  **首选 Web UI**: 所有的配置、开关、交互优先在 Web Dashboard (`localhost:3001`) 完成。
    2.  **次选原生 Explorer**: 打开文件夹等操作，直接调用 `explorer.exe "path"`，这是系统最稳定的进程。
    3.  **最后才用 WinForms**: 必须包含失败后的兜底方案（例如：Folder Picker 弹不出 -> 允许用户手动输入路径）。

### 🚀 开机自启标准实现 (Autostart)
*   **废弃**: 不要使用“启动文件夹快捷方式” (.lnk)，易被误删且状态检测困难。
*   **标准**: 使用 **Windows 注册表 Run Key**。
    *   路径: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
    *   优点: 状态读取准确，用户级权限即可操作，无需管理员。

---

## 3. 调试与排查流程 (The Debugging Protocol)

当遇到“功能失效”或“没反应”时，**禁止盲目改代码**，必须严格遵守以下顺序：

### Step 1: 检查输入源 (Input Validation)
*   **案例**: *iPad 投送 URL 失败*。
*   **检查**: Server 到底收到了什么？是纯 URL 还是包含了回车符/空格的文字？
*   **动作**: 看日志里的 `[接收]` 或 `Received` 字段。

### Step 2: 区分环境差异 (Environment Diff)
*   **案例**: *文件夹选择器本地好用，打包后挂了*。
*   **检查**: 是 `node server.js` 运行的，还是 `OmniDrop.exe` 运行的？
*   **认知**: `pkg` 打包后的环境没有标准 stdout 宿主，且路径 (`process.cwd` vs `process.execPath`) 行为不同。

### Step 3: 查看黑色窗口日志 (Log Check)
*   任何 Report 必须附带 `OmniDrop.exe` 黑色命令行的输出。
*   **Golden Template**:
    > "我做了 [动作]，期望 [结果]，但实际发生了 [现象]。这是控制台日志截图：[Log]"

---

## 4. 打包与发布流程 (Build Workflow)

每次交付新版本时，必须执行的标准动作序列：

1.  **清理现场**:
    ```powershell
    Stop-Process -Name "OmniDrop" -Force          # 杀进程防锁死
    Remove-Item "dist\OmniDrop.exe" -Force        # 删旧包
    ```
2.  **构建**:
    ```powershell
    pkg . -t node18-win-x64 --out-path dist       # 使用 pkg 构建
    ```
3.  **重命名与整理**:
    *   `pkg` 默认输出名可能为 `lan-clipboard.exe`，必须重命名为 `OmniDrop.exe` 以匹配 VBS 脚本和注册表项。
4.  **验证**:
    *   先运行 exe 确认无报错。
    *   再运行 VBS 确认静默启动正常。

---

## 5. 项目文件结构规范 (Structure)

```text
/
├── server.js              # 核心业务逻辑
├── package.json           # 依赖与 pkg 配置 (bin 入口)
├── dist/                  # 交付目录
│   ├── OmniDrop.exe       # 主程序 (带调试窗口)
│   ├── OmniDrop.vbs       # 生产环境启动器 (无窗口)
│   ├── config.json        # 用户配置 (打包后自动生成)
│   └── README.txt         # 给最终用户的说明
└── iPad快捷指令...md       # 客户端配套文档
```
