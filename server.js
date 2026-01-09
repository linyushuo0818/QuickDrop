/**
 * LAN Clipboard v2 - 局域网剪贴板同步工具
 * 
 * 功能：
 * - 图片/文字复制到剪贴板
 * - 文件传输
 * - URL 快捷打开
 * - 剪贴板历史记录
 * - 双向同步（拉取模式）
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const multer = require('multer');
const QRCode = require('qrcode');

const app = express();
const PORT = 3001;
function normalizePanelMode(value) {
    const mode = (value || '').toLowerCase();
    if (mode === 'app') return 'browser';
    if (['none', 'browser', 'electron'].includes(mode)) return mode;
    return 'electron';
}

const PANEL_MODE = (() => {
    const arg = process.argv.find((value) => value.startsWith('--panel='));
    if (arg) return normalizePanelMode(arg.split('=').slice(1).join('=').trim());
    if (process.argv.includes('--no-panel')) return 'none';
    if (process.argv.includes('--browser')) return 'browser';
    return normalizePanelMode(process.env.OMNIDROP_PANEL || 'electron');
})();

// ========== 目录配置 ==========
// 配置文件路径 (放在 exe 同级目录)
const CONFIG_FILE = path.join(path.dirname(process.execPath), 'config.json');

// 默认配置
let config = {
    // 默认保存到桌面的 OmniDrop_Files 文件夹
    dataDir: path.join(os.homedir(), 'Desktop', 'OmniDrop_Files')
};

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (saved.dataDir) config.dataDir = saved.dataDir;
        }
    } catch (e) {
        console.error('加载配置失败:', e);
    }
    // 确保主目录存在
    if (!fs.existsSync(config.dataDir)) {
        try { fs.mkdirSync(config.dataDir, { recursive: true }); }
        catch (e) { console.error('创建目录失败:', e); config.dataDir = os.tmpdir(); }
    }
}
function saveConfig() {
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8'); }
    catch (e) { console.error('保存配置失败:', e); }
}

// 初始化
loadConfig();

// 临时目录
const TEMP_DIR = path.join(os.tmpdir(), 'lan-clipboard');
// 历史记录 (动态获取)
const getHistoryFile = () => path.join(config.dataDir, 'history.json');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });


// ========== Multer 配置 (文件上传) ==========
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // 动态使用当前配置的目录
        if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
        cb(null, config.dataDir);
    },
    filename: function (req, file, cb) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safeName = file.originalname.replace(/[<>:"/\\|?*]/g, '_');
        cb(null, `${timestamp}_${safeName}`);
    }
});
const upload = multer({ storage: storage });

// ========== 历史记录管理 (Partitioned & Atomic) ==========
const HISTORY_RETENTION_DAYS = 7;

// 获取今天的历史记录文件名
const getTodayHistoryFile = () => {
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(config.dataDir, `history_${dateStr}.json`);
};

// 原子写入 JSON (防止写入中断导致文件损坏)
function writeJsonAtomic(filePath, data) {
    const tempFile = `${filePath}.tmp`;
    try {
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
        if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) { }
        }
        fs.renameSync(tempFile, filePath);
    } catch (e) {
        console.error(`[存储] 原子写入失败: ${e.message}`);
        try { fs.unlinkSync(tempFile); } catch (err) { }
    }
}

/**
 * 读取最近 N 天的历史记录
 */
function loadHistory() {
    let allRecords = [];
    try {
        if (!fs.existsSync(config.dataDir)) return [];

        const files = fs.readdirSync(config.dataDir).filter(f => f.match(/^history_\d{4}-\d{2}-\d{2}\.json$/));
        const today = new Date();
        const cutoff = new Date(today.getTime() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);

        // 排序：新日期在前
        files.sort().reverse();

        for (const file of files) {
            const datePart = file.replace('history_', '').replace('.json', '');
            const fileDate = new Date(datePart);

            // 只要文件日期在保留期内
            if (fileDate >= cutoff || datePart === today.toISOString().split('T')[0]) {
                try {
                    const filePath = path.join(config.dataDir, file);
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    const records = JSON.parse(fileContent);
                    if (Array.isArray(records)) {
                        allRecords = allRecords.concat(records);
                    }
                } catch (e) {
                    console.error(`[历史] 读取文件出错 ${file}: ${e.message}`);
                }
            } else {
                // 过期文件清理
                try {
                    console.log(`[历史] 清理过期文件: ${file}`);
                    fs.unlinkSync(path.join(config.dataDir, file));
                } catch (e) { }
            }
        }
    } catch (e) {
        console.error('[历史记录] 读取失败:', e.message);
    }

    // 内存中最后按时间戳倒序一下
    return allRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/**
 * 添加历史记录 (只写入当天的文件)
 */
function addToHistory(type, content, meta) {
    // 1. 读取当天的记录
    const todayFile = getTodayHistoryFile();
    let todayRecords = [];

    try {
        if (fs.existsSync(todayFile)) {
            todayRecords = JSON.parse(fs.readFileSync(todayFile, 'utf8'));
        }
    } catch (e) {
        console.error('[历史] 读取当天记录失败，重置为空');
    }

    // 2. 构造新记录
    // 预览图/文生成
    let preview = meta && meta.preview ? meta.preview : null;
    if (!preview) {
        preview = content.length > 100 ? content.substring(0, 100) + '...' : content;
    }

    const record = {
        id: Date.now(),
        type: type,
        content: content,
        preview: preview,
        meta: meta || {},
        timestamp: new Date().toISOString()
    };

    // 3. 插入并保存 (新记录在前)
    todayRecords.unshift(record);
    writeJsonAtomic(todayFile, todayRecords);

    return record;

}

function clearHistory() {
    try {
        if (!fs.existsSync(config.dataDir)) return;
        const files = fs.readdirSync(config.dataDir)
            .filter((file) => /^history_\d{4}-\d{2}-\d{2}\.json$/.test(file));
        for (const file of files) {
            try { fs.unlinkSync(path.join(config.dataDir, file)); } catch (e) { }
        }
    } catch (e) {
        console.error('[history] Clear failed:', e.message);
    }
}

// 启动时清理一次 (触发 loadHistory 的懒清理逻辑)
loadHistory();

// ========== 双向同步队列 ==========
let pendingForIPad = null; // 等待 iPad 拉取的内容

// 解析 JSON 请求体，设置较大的限制以支持大文件
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));


/**
 * 获取本机局域网 IP 地址
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                // 优先选择常见的局域网 IP 段
                if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
                    candidates.unshift(iface.address);
                } else if (!iface.address.startsWith('198.18.')) {
                    // 排除代理虚拟 IP
                    candidates.push(iface.address);
                }
            }
        }
    }

    return candidates.length > 0 ? candidates[0] : '127.0.0.1';
}

/**
 * 使用 PowerShell 将图片复制到 Windows 剪贴板
 * 必须使用 -STA 模式，否则剪贴板操作会失败
 */
function copyImageToClipboard(imagePath) {
    return new Promise((resolve, reject) => {
        // 创建一个临时的 PowerShell 脚本文件，避免命令行转义问题
        const psScriptPath = path.join(TEMP_DIR, 'clipboard_copy.ps1');
        const escapedPath = imagePath.replace(/\\/g, '\\\\').replace(/'/g, "''");
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
    $imagePath = '${escapedPath}'
    $image = [System.Drawing.Image]::FromFile($imagePath)
    [System.Windows.Forms.Clipboard]::SetImage($image)
    $image.Dispose()
    Write-Host "SUCCESS"
} catch {
    Write-Host "ERROR: $_"
    exit 1
}
`;

        fs.writeFileSync(psScriptPath, psScript, 'utf8');

        // 使用 -STA 参数确保剪贴板操作在单线程单元模式下运行
        runPowerShellFile(psScriptPath, { sta: true }, (error, stdout, stderr) => {
            // 清理脚本文件
            try { fs.unlinkSync(psScriptPath); } catch (e) { }

            if (error) {
                console.error('[PowerShell错误]', stderr || error.message);
                reject(new Error(stderr || error.message));
            } else if (stdout.includes('ERROR')) {
                console.error('[复制错误]', stdout);
                reject(new Error(stdout));
            } else {
                console.log('[PowerShell] 剪贴板复制成功');
                resolve();
            }
        });
    });
}

/**
 * 使用 PowerShell 将文字复制到 Windows 剪贴板
 * 使用临时文件方式避免命令行转义问题
 */
function copyTextToClipboard(text) {
    return new Promise((resolve, reject) => {
        // 创建临时文本文件，避免命令行转义问题
        const tempTextFile = path.join(TEMP_DIR, `text_${Date.now()}.txt`);
        const psScriptPath = path.join(TEMP_DIR, 'text_copy.ps1');

        // 保存文字到临时文件（UTF-8 编码）
        fs.writeFileSync(tempTextFile, text, 'utf8');

        // PowerShell 脚本：读取文件并复制到剪贴板
        // 使用双引号避免路径问题
        const escapedPath = tempTextFile.replace(/\\/g, '/');
        const psScript = `
$text = Get-Content -Path "${escapedPath}" -Raw -Encoding UTF8
Set-Clipboard -Value $text
Write-Host "SUCCESS"
`;

        fs.writeFileSync(psScriptPath, psScript, 'utf8');

        runPowerShellFile(psScriptPath, { sta: true }, (error, stdout, stderr) => {
            // 清理临时文件
            try { fs.unlinkSync(tempTextFile); } catch (e) { }
            try { fs.unlinkSync(psScriptPath); } catch (e) { }

            if (error) {
                console.error('[PowerShell错误]', stderr || error.message);
                reject(new Error(stderr || error.message));
            } else {
                console.log('[PowerShell] 文字复制成功');
                resolve();
            }
        });
    });
}


// 发送系统通知 (使用 PowerShell，无需依赖额外 exe)
function sendNotification(title, message) {
    console.log(`[通知] ${title}: ${message}`);

    // 简单的 PowerShell 通知脚本
    const psScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $textNodes = $template.GetElementsByTagName("text")
    $textNodes[0].AppendChild($template.CreateTextNode("${title}")) > $null
    $textNodes[1].AppendChild($template.CreateTextNode("${message}")) > $null
    $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("OmniDrop")
    $notifier.Show($toast)
    `;

    try {
        const child = spawnHidden('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
            stdio: 'ignore',
            detached: true
        });
        child.on('error', (err) => console.error('[通知错误]', err));
        child.unref();
    } catch (e) {
        console.error('[通知异常]', e);
    }
}

// ========== 核心逻辑：统一 Payload 处理 ==========

/**
 * 统一处理入口
 * @param {Object} payload 标准格式数据
 * {
 *   id: "uuid",
 *   type: "text" | "image" | "file" | "url",
 *   content: "内容或路径",
 *   meta: { filename, size, ... }
 * }
 */
async function handlePayload(payload) {
    const { type, content, meta } = payload;
    let result = { status: 'success', message: '已处理' };

    console.log(`[统一处理] 类型: ${type}, 内容预览: ${content.substring(0, 50)}...`);

    try {
        switch (type) {
            case 'text':
                await copyTextToClipboard(content);
                sendNotification('📋 文字已复制', content.length > 50 ? content.substring(0, 50) + '...' : content);
                break;

            case 'url':
                // 打开浏览器
                const cmd = `cmd /c start "" "${content.replace(/&/g, '^&')}"`; // 恢复转义逻辑，之前是因为选中文字导致的问题
                // 再次确认：cmd /c start "" "url" 是标准写法，^& 是必须的如果 url 含 &。
                // 之前的 bug 是因为 content 本身不是 url。这里我们假设 content 已经是 url。
                // 为了保险，先用不转义的简单版本，因为用户可能会乱传
                const openChild = spawnHidden('explorer.exe', [content], {
                    stdio: 'ignore',
                    detached: true
                });
                openChild.on('error', (err) => console.error('[url open error]', err.message));
                openChild.unref();
                await copyTextToClipboard(content);
                sendNotification('🔗 链接已打开', content);
                break;

            case 'image':
                // content 可能是 base64 或 文件路径
                if (fs.existsSync(content)) {
                    // 如果是路径
                    await copyImageToClipboard(content);
                } else {
                    // 假设是 base64，需要保存为临时文件
                    const buffer = Buffer.from(content.replace(/^data:image\/\w+;base64,/, ""), 'base64');
                    const tempParams = meta && meta.filename ? meta.filename.split('.') : ['clipboard', 'png'];
                    const ext = tempParams.length > 1 ? tempParams.pop() : 'png';
                    const tempFile = path.join(TEMP_DIR, `img_${Date.now()}.${ext}`);
                    fs.writeFileSync(tempFile, buffer);
                    await copyImageToClipboard(tempFile);
                    // 延时清理
                    setTimeout(() => { try { fs.unlinkSync(tempFile); } catch (e) { } }, 5000);
                }
                sendNotification('🖼️ 图片已复制', '可直接粘贴');
                break;

            case 'file':
                // content 必须是文件路径
                // 文件保存逻辑通常在 upload 中间件完成，这里只负责通知和历史记录
                // 如果 content 是 base64 (来自 iPad 直接传小文件)，则需要写入
                if (!fs.existsSync(content) && content.length > 255) {
                    // base64 写入
                    const buffer = Buffer.from(content, 'base64');
                    const fname = (meta && meta.filename) ? meta.filename : `file_${Date.now()}.bin`;
                    const savePath = path.join(config.dataDir, fname);
                    fs.writeFileSync(savePath, buffer);
                    payload.content = savePath; // 更新 content 为路径
                    if (!meta || !meta.silent) sendNotification('📁 文件已接收', `保存位置: ${savePath}`);
                } else {
                    if (!meta || !meta.silent) sendNotification('📁 文件已接收', `保存位置: ${content}`);
                }
                break;

            default:
                console.warn('[统一处理] 未知类型:', type);
                return { status: 'error', message: '未知数据类型' };
        }

        // 添加到历史记录
        addToHistory(type, payload.content, meta);

        return result;

    } catch (error) {
        console.error('[统一处理] 异常:', error);
        sendNotification('❌ 处理失败', error.message);
        throw error;
    }
}

/**
 * 主接口：统一上传入口 (Standard Entry Point)
 * POST /upload
 * 支持两种格式：
 * 1. 标准 Unified Schema: { type: "...", content: "...", meta: {...} }
 * 2. 旧版兼容: { data: "...", image: "...", text: "..." }
 */
app.post('/upload', async (req, res) => {
    try {
        const body = req.body;
        let payload = null;

        // 判定数据格式
        if (body.type && (body.content || body.data)) {
            // === 标准格式 ===
            payload = {
                id: Date.now().toString(),
                type: body.type,
                content: body.content || body.data,
                meta: body.meta || {},
                timestamp: Date.now()
            };
        } else {
            // === 旧版兼容模式 ===
            // 尝试智能识别
            let raw = body.data || body.image || body.text || '';
            if (!raw) return res.status(400).json({ status: 'error', message: '无数据' });

            // 简单判断类型
            if (body.image || (raw.startsWith('data:image') || raw.length > 10000)) {
                // 猜是图片
                payload = { type: 'image', content: raw, meta: { source: 'legacy' } };
            } else if (raw.match(/^https?:\/\//)) {
                // 猜是 URL
                payload = { type: 'url', content: raw, meta: { source: 'legacy' } };
            } else {
                // 默认文字
                payload = { type: 'text', content: raw, meta: { source: 'legacy' } };
            }
        }

        // 执行处理
        await handlePayload(payload);

        return res.json({ status: 'success', type: payload.type, message: '已处理' });

    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * 文字复制接口
 * POST /text
 * Body: { text: "要复制的文字" }
 */
/**
 * 文字复制接口 (Legacy Wrapper)
 * POST /text
 */
app.post('/text', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ status: 'error', message: '无数据' });

        await handlePayload({
            id: Date.now().toString(),
            type: 'text',
            content: text,
            meta: { source: '/text' },
            timestamp: Date.now()
        });

        res.json({ status: 'success', message: '已处理' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

/**
 * 健康检查接口
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'LAN Clipboard v2 运行中',
        dataDir: config.dataDir,
        historyCount: loadHistory().length
    });
});

// ========== 新功能端点 ==========

/**
 * 文件传输接口 (Multipart) - 支持多文件
 * POST /file
 * Form-Data: file=[文件对象] (支持多个)
 */
app.post('/file', upload.any(), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ status: 'error', message: '未收到文件' });
        }

        console.log(`[文件] 收到 ${files.length} 个文件`);
        const savedFiles = [];

        // 批量处理
        for (const file of files) {
            console.log(`[文件] 保存: ${file.originalname}`);

            // 复用 handlePayload 的历史记录逻辑 (静默模式，最后统一通知)
            await handlePayload({
                id: Date.now().toString() + Math.random(),
                type: 'file',
                content: file.path,
                meta: {
                    filename: file.originalname,
                    size: file.size,
                    source: '/file',
                    silent: true // 禁止 handlePayload 单独发通知
                },
                timestamp: Date.now()
            });
            savedFiles.push(file.originalname);
        }

        // 发送汇总通知
        if (savedFiles.length === 1) {
            sendNotification('📁 文件已接收', `${savedFiles[0]}\n保存到: ${config.dataDir}`);
        } else {
            sendNotification('📁 文件已接收', `共收到 ${savedFiles.length} 个文件\n保存到: ${config.dataDir}`);
        }

        return res.json({
            status: 'success',
            message: `成功接收 ${files.length} 个文件`,
            files: savedFiles
        });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * URL 打开接口
 * POST /url
 * Body: { url: "https://example.com" }
 */
/**
 * URL 打开接口 (Legacy Wrapper)
 * POST /url
 */
app.post('/url', async (req, res) => {
    try {
        const { url, data } = req.body;
        const targetUrl = url || data;
        if (!targetUrl) return res.status(400).json({ status: 'error', message: '未提供 URL' });

        await handlePayload({
            id: Date.now().toString(),
            type: 'url',
            content: targetUrl,
            meta: { source: '/url' },
            timestamp: Date.now()
        });

        res.json({ status: 'success', message: 'URL 已处理' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

/**
 * QR Code Config Endpoint
 * GET /qrcode
 */
app.get('/qrcode', async (req, res) => {
    try {
        const ip = getLocalIP();
        const url = `http://${ip}:${PORT}`;
        const qrData = await QRCode.toDataURL(url);
        res.json({ status: 'success', qrData, url });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

/**
 * 获取历史记录
 * GET /history
 */
app.get('/history', (req, res) => {
    const history = loadHistory();
    res.json({
        status: 'ok',
        count: history.length,
        retentionDays: HISTORY_RETENTION_DAYS,
        records: history
    });
});

/**
 * 清空历史记录
 * DELETE /history
 */
app.delete('/history', (req, res) => {
    clearHistory();
    console.log('[历史记录] 已清空');
    res.json({ status: 'ok', message: '历史记录已清空' });
});

/**
 * 双向同步 - 推送内容到 iPad 等待队列
 * POST /push
 * Body: { data: "内容", type: "text|image|url" }
 */
app.post('/push', async (req, res) => {
    try {
        const { data, type } = req.body;

        if (!data) {
            return res.status(400).json({ status: 'error', message: '未提供内容' });
        }

        pendingForIPad = {
            id: Date.now().toString(),
            type: type || 'text',
            content: data,
            meta: { source: 'pc_push' },
            timestamp: Date.now()
        };

        console.log(`[推送] 内容已加入等待队列 (${type || 'text'})`);
        sendNotification('📤 已准备发送到 iPad', '请在 iPad 上运行"获取电脑剪贴板"快捷指令');

        return res.json({
            status: 'success',
            message: '内容已加入等待队列，等待 iPad 拉取'
        });

    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * 双向同步 - iPad 拉取内容
 * GET /pull
 */
app.get('/pull', (req, res) => {
    if (pendingForIPad) {
        let content = pendingForIPad;
        pendingForIPad = null; // 拉取后清空
        console.log('[拉取] iPad 已获取内容');

        // Clean Base64 for iPad (strip data:image/...;base64, prefix AND newlines)
        let finalContent = content.content;
        if (typeof finalContent === 'string') {
            if (content.type === 'image') {
                finalContent = finalContent.replace(/^data:image\/[a-z]+;base64,/, '');
            }
            // Remove line breaks which kill iPad Shortcuts decoding
            finalContent = finalContent.replace(/[\r\n]+/g, '');
        }

        return res.json({
            status: 'ok',
            data: finalContent, // 兼容旧版字段
            content: finalContent,
            type: content.type,
            meta: content.meta,
            timestamp: content.timestamp
        });
    } else {
        return res.json({
            status: 'empty',
            message: '没有待拉取的内容'
        });
    }
});

/**
 * 获取服务状态和配置信息
 * GET /status
 */
app.get('/status', (req, res) => {
    const history = loadHistory();
    res.json({
        status: 'ok',
        version: '2.0',
        ip: getLocalIP(),
        port: PORT,
        dataDir: config.dataDir,
        historyCount: history.length,
        pendingForIPad: pendingForIPad !== null
    });
});


/**
 * 弹出系统文件夹选择框
 * POST /select-folder
 */
app.post('/select-folder', (req, res) => {
    // 创建临时 PowerShell 脚本文件
    const tempPs1 = path.join(TEMP_DIR, 'select_folder.ps1');
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "请选择 OmniDrop 文件保存位置"
$dialog.ShowNewFolderButton = $true
$dialog.RootFolder = [System.Environment+SpecialFolder]::Desktop
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}
`;

    try {
        fs.writeFileSync(tempPs1, psScript, 'utf8');
    } catch (e) {
        return res.json({ status: 'error', message: '无法创建脚本: ' + e.message });
    }

    // 使用 -STA -File 执行脚本文件
    runPowerShellFile(tempPs1, { sta: true }, (error, stdout, stderr) => {
        // 清理临时文件
        try { fs.unlinkSync(tempPs1); } catch (e) { }

        if (error) {
            console.error('[选择目录错误]', stderr || error.message);
            return res.json({ status: 'error', message: stderr || error.message });
        }
        const selectedPath = stdout.trim();
        console.log('[选择目录] 结果:', selectedPath || '(empty/cancelled)');
        if (selectedPath && selectedPath.length > 0) {
            return res.json({ status: 'success', path: selectedPath });
        } else {
            return res.json({ status: 'cancel' });
        }
    });
});

/**
 * 更新配置
 * POST /config
 * Body: { dataDir: "..." }
 */
app.post('/config', (req, res) => {
    const { dataDir } = req.body;
    if (dataDir && dataDir.trim().length > 0) {
        try {
            // 尝试创建目录以验证权限
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            config.dataDir = dataDir;
            saveConfig();
            console.log(`[配置] 数据目录已更新为: ${dataDir}`);
            sendNotification('配置更新', `保存路径已更改为: ${dataDir}`);
            return res.json({ status: 'success', message: '配置已更新' });
        } catch (e) {
            return res.status(500).json({ status: 'error', message: '无法使用该目录: ' + e.message });
        }
    }
    res.status(400).json({ status: 'error', message: '无效的路径' });
});

// 注册表 Run key 路径（比快捷方式更可靠）
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'OmniDrop';
const getExePath = () => process.execPath;

/**
 * 检查开机自启状态（通过注册表）
 * GET /autostart
 */
app.get('/autostart', (req, res) => {
    runHidden('reg', ['query', RUN_KEY, '/v', RUN_VALUE], null, (error, stdout) => {
        // 如果查询成功且包含 OmniDrop，说明已启用
        const enabled = !error && stdout.includes(RUN_VALUE);
        res.json({ enabled, exe: getExePath() });
    });
});

/**
 * 设置开机自启（通过注册表）
 * POST /autostart
 * Body: { enabled: true/false }
 */
app.post('/autostart', (req, res) => {
    const { enabled } = req.body;
    const exePath = getExePath();

    if (enabled) {
        // 添加到注册表 Run key
        const regData = `"${exePath}"`;
        runHidden('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', regData, '/f'], null, (error, stdout, stderr) => {
            if (error) {
                console.error('[开机自启] 添加注册表失败:', stderr);
                return res.json({ status: 'error', message: '添加注册表失败: ' + stderr });
            }
            console.log('[开机自启] 已启用（注册表）');
            sendNotification('开机自启已启用', '下次开机将自动启动 OmniDrop');
            return res.json({ status: 'success', enabled: true });
        });
    } else {
        // 从注册表删除
        runHidden('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], null, (error, stdout, stderr) => {
            // 即使不存在也算成功
            console.log('[开机自启] 已禁用（注册表）');
            sendNotification('开机自启已禁用', 'OmniDrop 将不再开机启动');
            return res.json({ status: 'success', enabled: false });
        });
    }
});

/**
 * 打开保存目录
 * POST /open-dir
 */
app.post('/open-dir', (req, res) => {
    const dir = config.dataDir || path.dirname(getExePath());
    // 确保目录存在
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { }
    }
    try {
        const child = spawnHidden('explorer.exe', [dir], { stdio: 'ignore', detached: true });
        child.on('error', () => { });
        child.unref();
        return res.json({ status: 'success', opened: dir });
    } catch (error) {
        return res.json({ status: 'error', message: '??????' });
    }
});

/**
 * 仪表盘页面
 * GET /
 */
app.get('/', (req, res) => {
    const localIP = getLocalIP();
    const serverAddress = `http://${localIP}:${PORT}`;
    const currentDataDir = config.dataDir.replace(/\\/g, '\\\\');


    // Dashboard HTML loaded from external file
    const templatePath = path.join(__dirname, 'dashboard.html');
    let htmlContent = '<h1>Template Not Found</h1>';
    try {
        htmlContent = fs.readFileSync(templatePath, 'utf8');
    } catch (e) {
        console.error('Dashboard template missing:', e);
    }
    const html = htmlContent.replace(/{{SERVER_ADDRESS}}/g, serverAddress);
    res.send(html);
});

// 启动服务器

const PANEL_LOG_PREFIX = '[panel]';

function logPanel(message) {
    console.log(`${PANEL_LOG_PREFIX} ${message}`);
}

function quoteArg(value) {
    if (!value) return '""';
    if (/[\s"]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
    return value;
}

function formatCommandLine(command, args) {
    if (!args || args.length === 0) return command;
    return [command, ...args].join(' ');
}

function spawnHidden(command, args, options) {
    return spawn(command, args, { windowsHide: true, ...(options || {}) });
}

function runHidden(command, args, options, callback) {
    const child = spawnHidden(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(options || {})
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });
    child.on('error', (err) => callback(err, stdout, stderr));
    child.on('close', (code) => {
        if (code !== 0) {
            const err = new Error(`exit ${code}`);
            err.code = code;
            return callback(err, stdout, stderr);
        }
        return callback(null, stdout, stderr);
    });
    return child;
}

function runPowerShellFile(psScriptPath, options, callback) {
    const args = ['-NoProfile', '-WindowStyle', 'Hidden'];
    if (options && options.sta) args.push('-STA');
    args.push('-ExecutionPolicy', 'Bypass', '-File', psScriptPath);
    return runHidden('powershell', args, options && options.spawnOptions ? options.spawnOptions : undefined, callback);
}

function spawnDetached(commandLine, label, options, onError) {
    logPanel(`spawn ${label}: ${commandLine}`);
    const child = spawn(commandLine, {
        shell: true,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        ...(options || {})
    });
    child.on('error', (err) => {
        logPanel(`spawn error ${label}: ${err.message}`);
        if (onError) onError(err);
    });
    child.on('exit', (code, signal) => {
        logPanel(`spawn exit ${label}: code=${code} signal=${signal || 'none'}`);
    });
    child.unref();
    return child;
}

function findOnPath(command) {
    try {
        const result = spawnSync('where', [command], { encoding: 'utf8', windowsHide: true });
        if (result.status === 0) {
            const line = result.stdout.split(/\r?\n/).find((value) => value && value.trim().length > 0);
            if (line) return line.trim();
        }
    } catch (e) { }
    return null;
}

function resolveBrowserExecutable(name) {
    const fromPath = findOnPath(name);
    if (fromPath && fs.existsSync(fromPath)) return fromPath;

    const candidates = [];
    if (name === 'msedge') {
        candidates.push('C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe');
        candidates.push('C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe');
    } else if (name === 'chrome') {
        candidates.push('C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe');
        candidates.push('C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe');
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}

function resolveElectronPanelPath() {
    const exeDir = path.dirname(process.execPath);
    return path.join(exeDir, '..', 'app', 'OmniDrop.exe');
}

function launchBrowserPanel(panelUrl) {
    const edgeExe = resolveBrowserExecutable('msedge');
    if (edgeExe) {
        logPanel(`browser=edge exe=${edgeExe}`);
        const commandLine = formatCommandLine(quoteArg(edgeExe), [`--app=${panelUrl}`]);
        spawnDetached(commandLine, 'edge');
        return true;
    }
    logPanel('browser=edge not found (PATH/default paths).');

    const chromeExe = resolveBrowserExecutable('chrome');
    if (chromeExe) {
        logPanel(`browser=chrome exe=${chromeExe}`);
        const commandLine = formatCommandLine(quoteArg(chromeExe), [`--app=${panelUrl}`]);
        spawnDetached(commandLine, 'chrome');
        return true;
    }
    logPanel('browser=chrome not found (PATH/default paths).');

    logPanel('fallback=start "" http://127.0.0.1:PORT');
    spawnDetached(formatCommandLine('start', ['""', quoteArg(panelUrl)]), 'browser-fallback');
    return false;
}

function openPanel(panelUrl) {
    logPanel(`mode=${PANEL_MODE} url=${panelUrl}`);
    if (PANEL_MODE === 'none') {
        logPanel('skip: panel disabled');
        return;
    }

    if (PANEL_MODE === 'electron') {
        const panelExe = resolveElectronPanelPath();
        logPanel(`electron target=${panelExe}`);
        if (fs.existsSync(panelExe)) {
            const commandLine = formatCommandLine(quoteArg(panelExe), [quoteArg(`--server-url=${panelUrl}`)]);
            const panelCwd = path.dirname(panelExe);
            spawnDetached(commandLine, 'electron', { cwd: panelCwd });
            return;
        }
        logPanel(`electron panel missing: ${panelExe}`);
        logPanel('fallback to browser');
    }

    launchBrowserPanel(panelUrl);
}
app.listen(PORT, () => {
    const localIP = getLocalIP();
    const url = `http://${localIP}:${PORT}`;
    const panelUrl = `http://127.0.0.1:${PORT}`;

    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║           🚀 OmniDrop 服务已启动 (v2.6)              ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  管理页面: ${url}`);
    console.log('║  (已自动在浏览器打开，如未打开请手动访问)            ║');
    console.log('╠══════════════════════════════════════════════════════╣');
    console.log(`║  数据目录: ${config.dataDir}`);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    // 启动时发送通知
    sendNotification('OmniDrop 已启动', `服务运行在: ${url}`);

    // 自动打开浏览器
    openPanel(panelUrl);
});
