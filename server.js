/**
 * LAN Clipboard v2 - 灞€鍩熺綉鍓创鏉垮悓姝ュ伐鍏?
 * 
 * 鍔熻兘锛?
 * - 鍥剧墖/鏂囧瓧澶嶅埗鍒板壀璐存澘
 * - 鏂囦欢浼犺緭
 * - URL 蹇嵎鎵撳紑
 * - 鍓创鏉垮巻鍙茶褰?
 * - 鍙屽悜鍚屾锛堟媺鍙栨ā寮忥級
 */

const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const multer = require('multer');
const QRCode = require('qrcode');

const app = express();
const PORT = 3001;
const MAX_BASE64_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_FILE_BYTES = 50 * 1024 * 1024;
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

// ========== 鐩綍閰嶇疆 ==========
// 閰嶇疆鏂囦欢璺緞 (鏀惧湪 exe 鍚岀骇鐩綍)
const CONFIG_FILE = path.join(path.dirname(process.execPath), 'config.json');

// 榛樿閰嶇疆
let config = {
    // 榛樿淇濆瓨鍒版闈㈢殑 OmniDrop_Files 鏂囦欢澶?
    dataDir: path.join(os.homedir(), 'Desktop', 'OmniDrop_Files')
};
let historyCount = 0;

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (saved.dataDir) config.dataDir = saved.dataDir;
        }
    } catch (e) {
        console.error('鍔犺浇閰嶇疆澶辫触:', e);
    }
    // 纭繚涓荤洰褰曞瓨鍦?
    if (!fs.existsSync(config.dataDir)) {
        try { fs.mkdirSync(config.dataDir, { recursive: true }); }
        catch (e) { console.error('鍒涘缓鐩綍澶辫触:', e); config.dataDir = os.tmpdir(); }
    }
}
function saveConfig() {
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8'); }
    catch (e) { console.error('淇濆瓨閰嶇疆澶辫触:', e); }
}

// 鍒濆鍖?
loadConfig();

// 涓存椂鐩綍
const TEMP_DIR = path.join(os.tmpdir(), 'lan-clipboard');
// 鍘嗗彶璁板綍 (鍔ㄦ€佽幏鍙?
const getHistoryFile = () => path.join(config.dataDir, 'history.json');

// 纭繚涓存椂鐩綍瀛樺湪
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function sanitizeFileName(value) {
    const name = path.basename(String(value || '')).trim();
    if (!name) return '';
    const cleaned = name
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned.slice(0, 200);
}

function resolveSafePath(baseDir, fileName) {
    const safeName = sanitizeFileName(fileName);
    if (!safeName) throw new Error('Invalid file name');
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(resolvedBase, safeName);
    const relative = path.relative(resolvedBase, resolvedTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('闈炴硶鏂囦欢璺緞');
    }
    return resolvedTarget;
}

function normalizeBase64(value) {
    if (!value) return '';
    return String(value)
        .replace(/^data:[^;]+;base64,/, '')
        .replace(/[\r\n\s]+/g, '');
}

function estimateBase64Bytes(base64) {
    if (!base64) return 0;
    let padding = 0;
    if (base64.endsWith('==')) padding = 2;
    else if (base64.endsWith('=')) padding = 1;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function getSafeImageExtension(fileName, content) {
    const allowed = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);
    const ext = path.extname(fileName || '').replace('.', '').toLowerCase();
    if (allowed.has(ext)) return ext;

    const raw = String(content || '').trim().toLowerCase();
    const match = raw.match(/^data:image\/([a-z0-9+.-]+);base64,/);
    if (match && match[1]) {
        const mimeExt = match[1] === 'pjpeg' ? 'jpg' : match[1];
        if (allowed.has(mimeExt)) return mimeExt;
    }

    const normalized = normalizeBase64(content);
    if (normalized.startsWith('/9j/')) return 'jpg';
    if (normalized.startsWith('iVBORw')) return 'png';
    if (normalized.startsWith('R0lGOD')) return 'gif';
    if (normalized.startsWith('UklGR')) return 'webp';
    if (normalized.startsWith('Qk')) return 'bmp';

    return 'png';
}

function isSafeHttpUrl(value) {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
        return false;
    }
}


// ========== Multer 閰嶇疆 (鏂囦欢涓婁紶) ==========
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // 鍔ㄦ€佷娇鐢ㄥ綋鍓嶉厤缃殑鐩綍
        if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
        cb(null, config.dataDir);
    },
    filename: function (req, file, cb) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safeName = sanitizeFileName(file.originalname) || 'file';
        cb(null, `${timestamp}_${safeName}`);
    }
});
const upload = multer({ storage: storage });

// ========== 鍘嗗彶璁板綍绠＄悊 (Partitioned & Atomic) ==========
const HISTORY_RETENTION_DAYS = 7;

// 鑾峰彇浠婂ぉ鐨勫巻鍙茶褰曟枃浠跺悕
const getTodayHistoryFile = () => {
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(config.dataDir, `history_${dateStr}.json`);
};

// 鍘熷瓙鍐欏叆 JSON (闃叉鍐欏叆涓柇瀵艰嚧鏂囦欢鎹熷潖)
async function writeJsonAtomic(filePath, data) {
    const tempFile = `${filePath}.tmp`;
    try {
        await fsp.writeFile(tempFile, JSON.stringify(data, null, 2), 'utf8');
        if (fs.existsSync(filePath)) {
            try { await fsp.unlink(filePath); } catch (e) { }
        }
        await fsp.rename(tempFile, filePath);
    } catch (e) {
        console.error(`[瀛樺偍] 鍘熷瓙鍐欏叆澶辫触: ${e.message}`);
        try { await fsp.unlink(tempFile); } catch (err) { }
    }
}

/**
 * 璇诲彇鏈€杩?N 澶╃殑鍘嗗彶璁板綍
 */
async function loadHistory() {
    let allRecords = [];
    try {
        if (!fs.existsSync(config.dataDir)) return [];

        const files = (await fsp.readdir(config.dataDir)).filter(f => f.match(/^history_\d{4}-\d{2}-\d{2}\.json$/));
        const today = new Date();
        const cutoff = new Date(today.getTime() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);

        // 鎺掑簭锛氭柊鏃ユ湡鍦ㄥ墠
        files.sort().reverse();

        for (const file of files) {
            const datePart = file.replace('history_', '').replace('.json', '');
            const fileDate = new Date(datePart);

            // 鍙鏂囦欢鏃ユ湡鍦ㄤ繚鐣欐湡鍐?
            if (fileDate >= cutoff || datePart === today.toISOString().split('T')[0]) {
                try {
                    const filePath = path.join(config.dataDir, file);
                    const fileContent = await fsp.readFile(filePath, 'utf8');
                    const records = JSON.parse(fileContent);
                    if (Array.isArray(records)) {
                        allRecords = allRecords.concat(records);
                    }
                } catch (e) {
                    console.error(`[鍘嗗彶] 璇诲彇鏂囦欢鍑洪敊 ${file}: ${e.message}`);
                }
            } else {
                // 杩囨湡鏂囦欢娓呯悊
                try {
                    console.log(`[鍘嗗彶] 娓呯悊杩囨湡鏂囦欢: ${file}`);
                    await fsp.unlink(path.join(config.dataDir, file));
                } catch (e) { }
            }
        }
    } catch (e) {
        console.error('[鍘嗗彶璁板綍] 璇诲彇澶辫触:', e.message);
    }

    // 鍐呭瓨涓渶鍚庢寜鏃堕棿鎴冲€掑簭涓€涓?
    const sorted = allRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    historyCount = sorted.length;
    return sorted;
}

/**
 * 娣诲姞鍘嗗彶璁板綍 (鍙啓鍏ュ綋澶╃殑鏂囦欢)
 */
async function addToHistory(type, content, meta) {
    // 1. 璇诲彇褰撳ぉ鐨勮褰?
    const todayFile = getTodayHistoryFile();
    let todayRecords = [];

    try {
        if (fs.existsSync(todayFile)) {
            todayRecords = JSON.parse(await fsp.readFile(todayFile, 'utf8'));
        }
    } catch (e) {
        console.error('[history] Failed to read today record file, resetting to empty');
    }

    // 2. 鏋勯€犳柊璁板綍
    // 棰勮鍥?鏂囩敓鎴?
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

    // 3. 鎻掑叆骞朵繚瀛?(鏂拌褰曞湪鍓?
    todayRecords.unshift(record);
    await writeJsonAtomic(todayFile, todayRecords);
    historyCount += 1;

    return record;

}

async function clearHistory() {
    try {
        if (!fs.existsSync(config.dataDir)) return;
        const files = (await fsp.readdir(config.dataDir))
            .filter((file) => /^history_\d{4}-\d{2}-\d{2}\.json$/.test(file));
        for (const file of files) {
            try { await fsp.unlink(path.join(config.dataDir, file)); } catch (e) { }
        }
    } catch (e) {
        console.error('[history] Clear failed:', e.message);
    }
    historyCount = 0;
}

async function removeHistoryRecordById(recordId) {
    const targetId = String(recordId || '').trim();
    if (!targetId) return 0;
    if (!fs.existsSync(config.dataDir)) return 0;

    let removedCount = 0;

    try {
        const files = (await fsp.readdir(config.dataDir))
            .filter((file) => /^history_\d{4}-\d{2}-\d{2}\.json$/.test(file));

        for (const file of files) {
            const filePath = path.join(config.dataDir, file);
            let records = [];
            try {
                records = JSON.parse(await fsp.readFile(filePath, 'utf8'));
            } catch (e) {
                continue;
            }

            if (!Array.isArray(records) || records.length === 0) continue;

            const next = records.filter((item) => String(item.id) !== targetId);
            const delta = records.length - next.length;
            if (delta <= 0) continue;

            removedCount += delta;
            await writeJsonAtomic(filePath, next);
        }

        if (removedCount > 0) {
            await loadHistory();
        }
    } catch (e) {
        console.error('[history] Remove by id failed:', e.message);
    }

    return removedCount;
}

// 鍚姩鏃舵竻鐞嗕竴娆?(瑙﹀彂 loadHistory 鐨勬噿娓呯悊閫昏緫)
loadHistory().catch((e) => console.error('[鍘嗗彶璁板綍] 鍚姩鍔犺浇澶辫触:', e.message));

// ========== 鍙屽悜鍚屾闃熷垪 ==========
let pendingForIPad = null; // 绛夊緟 iPad 鎷夊彇鐨勫唴瀹?

// 瑙ｆ瀽 JSON 璇锋眰浣擄紝璁剧疆杈冨ぇ鐨勯檺鍒朵互鏀寔澶ф枃浠?
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));


/**
 * 鑾峰彇鏈満灞€鍩熺綉 IP 鍦板潃
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                // 浼樺厛閫夋嫨甯歌鐨勫眬鍩熺綉 IP 娈?
                if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
                    candidates.unshift(iface.address);
                } else if (!iface.address.startsWith('198.18.')) {
                    // 鎺掗櫎浠ｇ悊铏氭嫙 IP
                    candidates.push(iface.address);
                }
            }
        }
    }

    return candidates.length > 0 ? candidates[0] : '127.0.0.1';
}

/**
 * 浣跨敤 PowerShell 灏嗗浘鐗囧鍒跺埌 Windows 鍓创鏉?
 * 蹇呴』浣跨敤 -STA 妯″紡锛屽惁鍒欏壀璐存澘鎿嶄綔浼氬け璐?
 */
function copyImageToClipboard(imagePath) {
    return new Promise((resolve, reject) => {
        // 鍒涘缓涓€涓复鏃剁殑 PowerShell 鑴氭湰鏂囦欢锛岄伩鍏嶅懡浠よ杞箟闂
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

        // 浣跨敤 -STA 鍙傛暟纭繚鍓创鏉挎搷浣滃湪鍗曠嚎绋嬪崟鍏冩ā寮忎笅杩愯
        runPowerShellFile(psScriptPath, { sta: true }, (error, stdout, stderr) => {
            // 娓呯悊鑴氭湰鏂囦欢
            try { fs.unlinkSync(psScriptPath); } catch (e) { }

            if (error) {
                console.error('[PowerShell閿欒]', stderr || error.message);
                reject(new Error(stderr || error.message));
            } else if (stdout.includes('ERROR')) {
                console.error('[澶嶅埗閿欒]', stdout);
                reject(new Error(stdout));
            } else {
                console.log('[powershell] Clipboard copy succeeded');
                resolve();
            }
        });
    });
}

/**
 * 浣跨敤 PowerShell 灏嗘枃瀛楀鍒跺埌 Windows 鍓创鏉?
 * 浣跨敤涓存椂鏂囦欢鏂瑰紡閬垮厤鍛戒护琛岃浆涔夐棶棰?
 */
function copyTextToClipboard(text) {
    return new Promise((resolve, reject) => {
        // 鍒涘缓涓存椂鏂囨湰鏂囦欢锛岄伩鍏嶅懡浠よ杞箟闂
        const tempTextFile = path.join(TEMP_DIR, `text_${Date.now()}.txt`);
        const psScriptPath = path.join(TEMP_DIR, 'text_copy.ps1');

        // 淇濆瓨鏂囧瓧鍒颁复鏃舵枃浠讹紙UTF-8 缂栫爜锛?
        fs.writeFileSync(tempTextFile, text, 'utf8');

        // PowerShell 鑴氭湰锛氳鍙栨枃浠跺苟澶嶅埗鍒板壀璐存澘
        // 浣跨敤鍙屽紩鍙烽伩鍏嶈矾寰勯棶棰?
        const escapedPath = tempTextFile.replace(/\\/g, '/');
        const psScript = `
$text = Get-Content -Path "${escapedPath}" -Raw -Encoding UTF8
Set-Clipboard -Value $text
Write-Host "SUCCESS"
`;

        fs.writeFileSync(psScriptPath, psScript, 'utf8');

        runPowerShellFile(psScriptPath, { sta: true }, (error, stdout, stderr) => {
            // 娓呯悊涓存椂鏂囦欢
            try { fs.unlinkSync(tempTextFile); } catch (e) { }
            try { fs.unlinkSync(psScriptPath); } catch (e) { }

            if (error) {
                console.error('[PowerShell閿欒]', stderr || error.message);
                reject(new Error(stderr || error.message));
            } else {
                console.log('[PowerShell] 鏂囧瓧澶嶅埗鎴愬姛');
                resolve();
            }
        });
    });
}


// 鍙戦€佺郴缁熼€氱煡 (浣跨敤 PowerShell锛屾棤闇€渚濊禆棰濆 exe)
function sendNotification(title, message) {
    console.log(`[閫氱煡] ${title}: ${message}`);

    // 绠€鍗曠殑 PowerShell 閫氱煡鑴氭湰
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
        child.on('error', (err) => console.error('[閫氱煡閿欒]', err));
        child.unref();
    } catch (e) {
        console.error('[閫氱煡寮傚父]', e);
    }
}

// ========== 鏍稿績閫昏緫锛氱粺涓€ Payload 澶勭悊 ==========

/**
 * 缁熶竴澶勭悊鍏ュ彛
 * @param {Object} payload 鏍囧噯鏍煎紡鏁版嵁
 * {
 *   id: "uuid",
 *   type: "text" | "image" | "file" | "url",
 *   content: "鍐呭鎴栬矾寰?,
 *   meta: { filename, size, ... }
 * }
 */
async function handlePayload(payload) {
    const { type, content, meta } = payload;
    let result = { status: 'success', message: 'Processed' };

    console.log(`[缁熶竴澶勭悊] 绫诲瀷: ${type}, 鍐呭棰勮: ${content.substring(0, 50)}...`);

    try {
        switch (type) {
            case 'text':
                await copyTextToClipboard(content);
                sendNotification('Text copied', content.length > 50 ? content.substring(0, 50) + '...' : content);
                break;

            case 'url':
                // ????????? http/https?
                if (isSafeHttpUrl(content)) {
                    const openChild = spawnHidden('explorer.exe', [content], {
                        stdio: 'ignore',
                        detached: true
                    });
                    openChild.on('error', (err) => console.error('[url open error]', err.message));
                    openChild.unref();
                } else {
                    console.warn('[url] unsafe url blocked:', content);
                }
                await copyTextToClipboard(String(content || ''));
                sendNotification('?? ?????', String(content || ''));
                break;

            case 'image':
                // content 鍙兘鏄?base64 鎴?鏂囦欢璺緞
                if (fs.existsSync(content)) {
                    // 濡傛灉鏄矾寰?
                    await copyImageToClipboard(content);
                } else {
                    // 鍋囪鏄?base64锛岄渶瑕佷繚瀛樹负涓存椂鏂囦欢
                    const rawBase64 = normalizeBase64(content);
                    const approxSize = estimateBase64Bytes(rawBase64);
                    if (approxSize > MAX_BASE64_IMAGE_BYTES) {
                        throw new Error('????');
                    }
                    const buffer = Buffer.from(rawBase64, 'base64');
                    const ext = getSafeImageExtension(meta && meta.filename, content);
                    const tempFile = path.join(TEMP_DIR, `img_${Date.now()}.${ext}`);
                    await fsp.writeFile(tempFile, buffer);
                    await copyImageToClipboard(tempFile);
                    // 寤舵椂娓呯悊
                    setTimeout(() => { try { fs.unlinkSync(tempFile); } catch (e) { } }, 5000);
                }
                sendNotification('Image copied', 'Ready to paste');
                break;

            case 'file':
                // content 蹇呴』鏄枃浠惰矾寰?
                // 鏂囦欢淇濆瓨閫昏緫閫氬父鍦?upload 涓棿浠跺畬鎴愶紝杩欓噷鍙礋璐ｉ€氱煡鍜屽巻鍙茶褰?
                // 濡傛灉 content 鏄?base64 (鏉ヨ嚜 iPad 鐩存帴浼犲皬鏂囦欢)锛屽垯闇€瑕佸啓鍏?
                if (!fs.existsSync(content) && content.length > 255) {
                    // base64 鍐欏叆
                    const rawBase64 = normalizeBase64(content);
                    const approxSize = estimateBase64Bytes(rawBase64);
                    if (approxSize > MAX_BASE64_FILE_BYTES) {
                        throw new Error('????');
                    }
                    const buffer = Buffer.from(rawBase64, 'base64');
                    const fname = sanitizeFileName(meta && meta.filename) || `file_${Date.now()}.bin`;
                    const savePath = resolveSafePath(config.dataDir, fname);
                    await fsp.writeFile(savePath, buffer);
                    payload.content = savePath; // 鏇存柊 content 涓鸿矾寰?
                    if (!meta || !meta.silent) sendNotification('File received', "Saved to: ");
                } else {
                    if (!meta || !meta.silent) sendNotification('File received', "Saved to: ");
                }
                break;

            default:
                console.warn('[缁熶竴澶勭悊] 鏈煡绫诲瀷:', type);
                return { status: 'error', message: '鏈煡鏁版嵁绫诲瀷' };
        }

        // 娣诲姞鍒板巻鍙茶褰?
        await addToHistory(type, payload.content, meta);

        return result;

    } catch (error) {
        console.error('[缁熶竴澶勭悊] 寮傚父:', error);
        sendNotification('鉂?澶勭悊澶辫触', error.message);
        throw error;
    }
}

/**
 * 涓绘帴鍙ｏ細缁熶竴涓婁紶鍏ュ彛 (Standard Entry Point)
 * POST /upload
 * 鏀寔涓ょ鏍煎紡锛?
 * 1. 鏍囧噯 Unified Schema: { type: "...", content: "...", meta: {...} }
 * 2. 鏃х増鍏煎: { data: "...", image: "...", text: "..." }
 */
app.post('/upload', async (req, res) => {
    try {
        const body = req.body;
        let payload = null;

        // 鍒ゅ畾鏁版嵁鏍煎紡
        if (body.type && (body.content || body.data)) {
            // === 鏍囧噯鏍煎紡 ===
            payload = {
                id: Date.now().toString(),
                type: body.type,
                content: body.content || body.data,
                meta: body.meta || {},
                timestamp: Date.now()
            };
        } else {
            // === 鏃х増鍏煎妯″紡 ===
            // 灏濊瘯鏅鸿兘璇嗗埆
            let raw = body.data || body.image || body.text || '';
            if (!raw) return res.status(400).json({ status: 'error', message: 'No data provided' });

            // 绠€鍗曞垽鏂被鍨?
            if (body.image || (raw.startsWith('data:image') || raw.length > 10000)) {
                // 鐚滄槸鍥剧墖
                payload = { type: 'image', content: raw, meta: { source: 'legacy' } };
            } else if (raw.match(/^https?:\/\//)) {
                // 鐚滄槸 URL
                payload = { type: 'url', content: raw, meta: { source: 'legacy' } };
            } else {
                // 榛樿鏂囧瓧
                payload = { type: 'text', content: raw, meta: { source: 'legacy' } };
            }
        }

        // 鎵ц澶勭悊
        if (payload && payload.meta && payload.meta.source === 'web_canvas') {
            return res.status(410).json({
                status: 'error',
                message: 'Canvas upload from dashboard has been removed'
            });
        }
        await handlePayload(payload);

        return res.json({ status: 'success', type: payload.type, message: 'Processed' });

    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * Dashboard copy endpoint
 * POST /copy
 * Body: { type: "text|image|url|file", content: "...", meta?: {} }
 * 璇存槑锛氫粎澶嶅埗鍒扮郴缁熷壀璐存澘锛屼笉鍐欏叆鍘嗗彶璁板綍銆? */
app.post('/copy', async (req, res) => {
    try {
        const body = req.body || {};
        const type = String(body.type || '').toLowerCase();
        const content = body.content;
        const meta = body.meta || {};

        if (!type || content === undefined || content === null || String(content).length === 0) {
            return res.status(400).json({ status: 'error', message: 'Missing copy payload' });
        }

        if (type === 'image') {
            if (typeof content === 'string' && fs.existsSync(content)) {
                await copyImageToClipboard(content);
            } else {
                const rawBase64 = normalizeBase64(content);
                const approxSize = estimateBase64Bytes(rawBase64);
                if (approxSize > MAX_BASE64_IMAGE_BYTES) {
                    return res.status(413).json({ status: 'error', message: 'Image is too large' });
                }
                const buffer = Buffer.from(rawBase64, 'base64');
                const ext = getSafeImageExtension(meta && meta.filename, content);
                const tempFile = path.join(TEMP_DIR, `copy_${Date.now()}.${ext}`);
                await fsp.writeFile(tempFile, buffer);
                await copyImageToClipboard(tempFile);
                setTimeout(() => { try { fs.unlinkSync(tempFile); } catch (e) { } }, 5000);
            }
            return res.json({ status: 'success', message: 'Image copied' });
        }

        // text/url/file 鍧囨寜鏂囨湰澶嶅埗锛屼繚璇佹祻瑙堝櫒绔棤鏉冮檺鏃朵緷鐒跺彲澶嶅埗
        await copyTextToClipboard(String(content));
        return res.json({ status: 'success', message: 'Copied' });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * 鏂囧瓧澶嶅埗鎺ュ彛
 * POST /text
 * Body: { text: "瑕佸鍒剁殑鏂囧瓧" }
 */
/**
 * 鏂囧瓧澶嶅埗鎺ュ彛 (Legacy Wrapper)
 * POST /text
 */
app.post('/text', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ status: 'error', message: 'No data provided' });

        await handlePayload({
            id: Date.now().toString(),
            type: 'text',
            content: text,
            meta: { source: '/text' },
            timestamp: Date.now()
        });

        res.json({ status: 'success', message: 'Processed' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

/**
 * 鍋ュ悍妫€鏌ユ帴鍙?
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'LAN Clipboard v2 is running',
        dataDir: config.dataDir,
        historyCount: historyCount
    });
});

// ========== 鏂板姛鑳界鐐?==========

/**
 * 鏂囦欢浼犺緭鎺ュ彛 (Multipart) - 鏀寔澶氭枃浠?
 * POST /file
 * Form-Data: file=[鏂囦欢瀵硅薄] (鏀寔澶氫釜)
 */
app.post('/file', upload.any(), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ status: 'error', message: 'No files received' });
        }

        console.log(`[file] Received ${files.length} files`);
        const savedFiles = [];

        // 鎵归噺澶勭悊
        for (const file of files) {
            console.log(`[鏂囦欢] 淇濆瓨: ${file.originalname}`);

            // 澶嶇敤 handlePayload 鐨勫巻鍙茶褰曢€昏緫 (闈欓粯妯″紡锛屾渶鍚庣粺涓€閫氱煡)
            await handlePayload({
                id: Date.now().toString() + Math.random(),
                type: 'file',
                content: file.path,
                meta: {
                    filename: file.originalname,
                    size: file.size,
                    source: '/file',
                    silent: true // 绂佹 handlePayload 鍗曠嫭鍙戦€氱煡
                },
                timestamp: Date.now()
            });
            savedFiles.push(file.originalname);
        }

        // 鍙戦€佹眹鎬婚€氱煡
        if (savedFiles.length === 1) {
            sendNotification('File received', `${savedFiles[0]}\nSaved to: ${config.dataDir}`);
        } else {
            sendNotification('Files received', `Received ${savedFiles.length} files\nSaved to: ${config.dataDir}`);
        }

        return res.json({
            status: 'success',
            message: 'Received ' + files.length + ' files',
            files: savedFiles
        });
    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * URL 鎵撳紑鎺ュ彛
 * POST /url
 * Body: { url: "https://example.com" }
 */
/**
 * URL 鎵撳紑鎺ュ彛 (Legacy Wrapper)
 * POST /url
 */
app.post('/url', async (req, res) => {
    try {
        const { url, data } = req.body;
        const targetUrl = url || data;
        if (!targetUrl) return res.status(400).json({ status: 'error', message: '鏈彁渚?URL' });

        await handlePayload({
            id: Date.now().toString(),
            type: 'url',
            content: targetUrl,
            meta: { source: '/url' },
            timestamp: Date.now()
        });

        res.json({ status: 'success', message: 'URL processed' });
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
 * 鑾峰彇鍘嗗彶璁板綍
 * GET /history
 */
app.get('/history', async (req, res) => {
    const history = await loadHistory();
    res.json({
        status: 'ok',
        count: history.length,
        retentionDays: HISTORY_RETENTION_DAYS,
        records: history
    });
});

/**
 * 娓呯┖鍘嗗彶璁板綍
 * DELETE /history
 */
app.delete('/history', async (req, res) => {
    await clearHistory();
    console.log('[history] Cleared');
    res.json({ status: 'ok', message: 'History cleared' });
});

app.delete('/history/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ status: 'error', message: 'Missing history id' });
    }

    const removedCount = await removeHistoryRecordById(id);
    if (removedCount <= 0) {
        return res.status(404).json({ status: 'error', message: 'Record not found' });
    }

    return res.json({ status: 'ok', message: 'Record deleted', removed: removedCount });
});

/**
 * 鍙屽悜鍚屾 - 鎺ㄩ€佸唴瀹瑰埌 iPad 绛夊緟闃熷垪
 * POST /push
 * Body: { data: "鍐呭", type: "text|image|url" }
 */
app.post('/push', async (req, res) => {
    try {
        const { data, type } = req.body;

        if (!data) {
            return res.status(400).json({ status: 'error', message: 'No content provided' });
        }

        pendingForIPad = {
            id: Date.now().toString(),
            type: type || 'text',
            content: data,
            meta: { source: 'pc_push' },
            timestamp: Date.now()
        };

        console.log(`[鎺ㄩ€乚 鍐呭宸插姞鍏ョ瓑寰呴槦鍒?(${type || 'text'})`);
        sendNotification('馃摛 宸插噯澶囧彂閫佸埌 iPad', '璇峰湪 iPad 涓婅繍琛?鑾峰彇鐢佃剳鍓创鏉?蹇嵎鎸囦护');

        return res.json({
            status: 'success',
            message: '鍐呭宸插姞鍏ョ瓑寰呴槦鍒楋紝绛夊緟 iPad 鎷夊彇'
        });

    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
});

/**
 * 鍙屽悜鍚屾 - iPad 鎷夊彇鍐呭
 * GET /pull
 */
app.get('/pull', (req, res) => {
    if (pendingForIPad) {
        let content = pendingForIPad;
        pendingForIPad = null; // 鎷夊彇鍚庢竻绌?
        console.log('[pull] iPad fetched pending content');

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
            data: finalContent, // 鍏煎鏃х増瀛楁
            content: finalContent,
            type: content.type,
            meta: content.meta,
            timestamp: content.timestamp
        });
    } else {
        return res.json({
            status: 'empty',
            message: '娌℃湁寰呮媺鍙栫殑鍐呭'
        });
    }
});

/**
 * 鑾峰彇鏈嶅姟鐘舵€佸拰閰嶇疆淇℃伅
 * GET /status
 */
app.get('/status', (req, res) => {
    res.json({
        status: 'ok',
        version: '2.0',
        ip: getLocalIP(),
        port: PORT,
        dataDir: config.dataDir,
        historyCount: historyCount,
        pendingForIPad: pendingForIPad !== null
    });
});


/**
 * 寮瑰嚭绯荤粺鏂囦欢澶归€夋嫨妗?
 * POST /select-folder
 */
app.post('/select-folder', (req, res) => {
    // 鍒涘缓涓存椂 PowerShell 鑴氭湰鏂囦欢
    const tempPs1 = path.join(TEMP_DIR, 'select_folder.ps1');
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$owner = New-Object System.Windows.Forms.Form
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1,1)
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0
$owner.Show()
$owner.Activate()

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select OmniDrop save folder"
$dialog.ShowNewFolderButton = $true
$dialog.RootFolder = [System.Environment+SpecialFolder]::Desktop

$result = $dialog.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}

$owner.Close()
`;

    try {
        fs.writeFileSync(tempPs1, psScript, 'utf8');
    } catch (e) {
        return res.json({ status: 'error', message: '鏃犳硶鍒涘缓鑴氭湰: ' + e.message });
    }

    // 浣跨敤 -STA -File 鎵ц鑴氭湰鏂囦欢
    runPowerShellFile(tempPs1, { sta: true }, (error, stdout, stderr) => {
        // 娓呯悊涓存椂鏂囦欢
        try { fs.unlinkSync(tempPs1); } catch (e) { }

        if (error) {
            console.error('[閫夋嫨鐩綍閿欒]', stderr || error.message);
            return res.json({ status: 'error', message: stderr || error.message });
        }
        const selectedPath = stdout.trim();
        console.log('[閫夋嫨鐩綍] 缁撴灉:', selectedPath || '(empty/cancelled)');
        if (selectedPath && selectedPath.length > 0) {
            return res.json({ status: 'success', path: selectedPath });
        } else {
            return res.json({ status: 'cancel' });
        }
    });
});

/**
 * 鏇存柊閰嶇疆
 * POST /config
 * Body: { dataDir: "..." }
 */
app.post('/config', (req, res) => {
    const { dataDir } = req.body;
    if (dataDir && dataDir.trim().length > 0) {
        try {
            // 灏濊瘯鍒涘缓鐩綍浠ラ獙璇佹潈闄?
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            config.dataDir = dataDir;
            saveConfig();
            console.log(`[閰嶇疆] 鏁版嵁鐩綍宸叉洿鏂颁负: ${dataDir}`);
            sendNotification('閰嶇疆鏇存柊', `淇濆瓨璺緞宸叉洿鏀逛负: ${dataDir}`);
            return res.json({ status: 'success', message: 'Config updated' });
        } catch (e) {
            return res.status(500).json({ status: 'error', message: '鏃犳硶浣跨敤璇ョ洰褰? ' + e.message });
        }
    }
    res.status(400).json({ status: 'error', message: 'Invalid path' });
});

// 娉ㄥ唽琛?Run key 璺緞锛堟瘮蹇嵎鏂瑰紡鏇村彲闈狅級
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE = 'OmniDrop';
const getExePath = () => process.execPath;
function getAutoStartCommand() {
    const exePath = getExePath();
    const exeName = path.basename(exePath).toLowerCase();
    const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
    const isNodeRuntime = exeName === 'node.exe' || exeName === 'node';

    if (isNodeRuntime && scriptPath && fs.existsSync(scriptPath)) {
        return `"${exePath}" "${scriptPath}" --panel=none`;
    }

    return `"${exePath}" --panel=none`;
}

/**
 * 妫€鏌ュ紑鏈鸿嚜鍚姸鎬侊紙閫氳繃娉ㄥ唽琛級
 * GET /autostart
 */
app.get('/autostart', (req, res) => {
    runHidden('reg', ['query', RUN_KEY, '/v', RUN_VALUE], null, (error, stdout) => {
        // 濡傛灉鏌ヨ鎴愬姛涓斿寘鍚?OmniDrop锛岃鏄庡凡鍚敤
        const enabled = !error && stdout.includes(RUN_VALUE);
        res.json({
            enabled,
            exe: getExePath(),
            command: getAutoStartCommand()
        });
    });
});

/**
 * 璁剧疆寮€鏈鸿嚜鍚紙閫氳繃娉ㄥ唽琛級
 * POST /autostart
 * Body: { enabled: true/false }
 */
app.post('/autostart', (req, res) => {
    const { enabled } = req.body;

    if (enabled) {
        // 娣诲姞鍒版敞鍐岃〃 Run key
        const regData = getAutoStartCommand();
        runHidden('reg', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', regData, '/f'], null, (error, stdout, stderr) => {
            if (error) {
                console.error('[寮€鏈鸿嚜鍚痌 娣诲姞娉ㄥ唽琛ㄥけ璐?', stderr);
                return res.json({ status: 'error', message: '娣诲姞娉ㄥ唽琛ㄥけ璐? ' + stderr });
            }
            console.log('[寮€鏈鸿嚜鍚痌 宸插惎鐢紙娉ㄥ唽琛級');
            sendNotification('寮€鏈鸿嚜鍚凡鍚敤', '涓嬫寮€鏈哄皢鑷姩鍚姩 OmniDrop');
            return res.json({ status: 'success', enabled: true });
        });
    } else {
        // 浠庢敞鍐岃〃鍒犻櫎
        runHidden('reg', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], null, (error, stdout, stderr) => {
            // 鍗充娇涓嶅瓨鍦ㄤ篃绠楁垚鍔?
            console.log('[寮€鏈鸿嚜鍚痌 宸茬鐢紙娉ㄥ唽琛級');
            sendNotification('Auto start disabled', 'OmniDrop will not auto-start at login');
            return res.json({ status: 'success', enabled: false });
        });
    }
});

/**
 * 鎵撳紑淇濆瓨鐩綍
 * POST /open-dir
 */
app.post('/open-dir', (req, res) => {
    const dir = config.dataDir || path.dirname(getExePath());
    // 纭繚鐩綍瀛樺湪
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
 * 浠〃鐩橀〉闈?
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

// 鍚姩鏈嶅姟鍣?

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
    console.log('---------------------------------------------');
    console.log('OmniDrop service started (v2.6)');
    console.log('---------------------------------------------');
    console.log(`Dashboard: ${url}`);
    console.log('If browser did not open automatically, open the URL manually.');
    console.log('---------------------------------------------');
    console.log(`Data directory: ${config.dataDir}`);
    console.log('---------------------------------------------');
    console.log('');

    // 鍚姩鏃跺彂閫侀€氱煡
    sendNotification('OmniDrop started', `Service is running at ${url}`);

    // 鑷姩鎵撳紑娴忚鍣?
    openPanel(panelUrl);
});

