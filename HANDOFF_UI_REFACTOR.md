# OmniDrop UI 重构交接（给新会话）

## 1) 当前状态（先读）
- 用户明确反馈：**现有新面板除字体外几乎都不满意**，需要从视觉与信息架构层面重新设计。
- 代码已改动但未被认可：`dashboard.html` 已重构多次，方向偏“功能正确”，但审美不达标。
- 后端新增了单条历史删除接口：`DELETE /history/:id`（可用来支撑卡片操作栏的删除）。
- 版本已提升到 `v1.3.2`。

## 2) 用户最新审美要求（高优先级）
- 视觉降噪：IP 区域不要巨大技术感，不要 `http://` 强占视觉。
- 路径语义化：不要直接展示 `E:\\...` 这种 Windows 路径，改成友好信息（如 `Desktop` / `OneDrive > Desktop`）。
- 弱化标题、强化内容：`Recent Records` 不应抢镜，内容卡片才是核心。
- 极简“小组件化”：参考 macOS Sequoia 原生感，留白克制，层次轻，微交互动效精细。
- 顶栏简化：`OmniDrop` + 小状态点 + 设置齿轮，其余控制按上下文露出。
- 核心连接区：左 QR、右 IP 两行（主机与端口分离），点击可复制并轻提示。
- 卡片交互：右下角细微操作栏（复制/打开/删除），但视觉不能喧宾夺主。

## 3) 关键文件
- 前端页面：`omnidrop/dashboard.html`
- 后端服务：`omnidrop/server.js`
- 说明文档：`omnidrop/README.md`
- 本交接：`omnidrop/HANDOFF_UI_REFACTOR.md`

## 4) 后端现有可用接口（UI 可直接调用）
- `GET /status`：拿 `ip/port/dataDir/historyCount/pendingForIPad`
- `GET /qrcode`：拿 `{ qrData, url }`
- `GET /history`：拿记录列表
- `POST /copy`：统一复制（text/url/file/image）
- `POST /autostart` / `GET /autostart`
- `POST /open-dir`
- `POST /select-folder`
- `POST /config`
- `DELETE /history`：清空历史
- `DELETE /history/:id`：删除单条历史（已新增）

## 5) 已实现但待确认的问题
- `DELETE /history/:id` 已写入 `server.js`，但如果本机仍运行旧进程，请重启服务后再测。
- 当前 `dashboard.html` 功能完整但审美未达标，建议**保留逻辑函数思路，重做结构与样式**。

## 6) 建议的接手策略（新会话执行）
1. **先冻结视觉目标**：用 3 句话定义风格（克制、编辑感、中性暖灰，强调色极少）。
2. **先做信息架构再写 CSS**：顶栏 / 核心连接区 / 设置行 / 内容区，逐区块重排。
3. **卡片优先级倒置**：先把记录卡做漂亮，再反推页面尺度与标题弱化。
4. **减少“控制噪音”**：设置项合并，操作露出按 hover/焦点触发，不常驻大按钮组。
5. **每次改动都跑冒烟**：`/status`、`/history`、复制、路径选择、删除单条记录。

## 7) 需要避免的坑
- 不要再次出现超大技术文本（协议头、路径原文、过大标签）。
- 不要让“标题/控件”比“内容”更抢眼。
- 不要出现“功能都在但像后台管理系统”的密集感。
- 不要新增花哨动画，保持克制，重点只做呼吸点/微 hover/复制反馈。

## 8) 本地运行与验证
```bash
cd e:\OneDrive\Antigravity\omnidrop
npm install
npm run start
# 打开 http://127.0.0.1:3001
```

最小验收：
- IP 显示是否清爽（无协议噪音）
- 路径是否语义化（无 `E:\...` 直出）
- Recent 区是否“内容优先”
- 卡片操作栏是否细微且可用
- 删除单条记录是否持久生效

## 9) 当前工作区改动（供新会话感知）
- 已改未提交文件：
  - `omnidrop/dashboard.html`
  - `omnidrop/server.js`
  - `omnidrop/README.md`
  - `omnidrop/package.json`
  - `omnidrop/package-lock.json`
- 未跟踪目录：`omnidrop/scripts/`（不要误删）

