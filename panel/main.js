const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const PANEL_LOG_PREFIX = '[panel]';

function logPanel(message) {
    console.log(`${PANEL_LOG_PREFIX} ${message}`);
}

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
        const value = argv[i];
        if (!value.startsWith('--')) continue;
        const [key, inlineValue] = value.replace(/^--/, '').split('=');
        if (inlineValue !== undefined) {
            args[key] = inlineValue;
        } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
            args[key] = argv[i + 1];
            i += 1;
        } else {
            args[key] = true;
        }
    }
    return args;
}

const args = parseArgs(process.argv);
const PORT = Number(args.port || process.env.OMNIDROP_PORT || 3001);
const SERVER_URL = args['server-url'] || process.env.OMNIDROP_SERVER_URL || `http://127.0.0.1:${PORT}`;
const SERVER_PATH = args['server-path'] || process.env.OMNIDROP_SERVER_PATH;

let mainWindow = null;
let tray = null;
let quitting = false;
let serverProcess = null;
let serverReady = false;

function getAppIconPath() {
    const candidates = [
        path.join(__dirname, 'assets', 'icon.ico'),
        path.join(app.getAppPath(), 'panel', 'assets', 'icon.ico')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function getTrayIcon() {
    const candidates = [
        path.join(__dirname, 'assets', 'tray.png'),
        path.join(app.getAppPath(), 'panel', 'assets', 'tray.png')
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return nativeImage.createFromPath(candidate);
        }
    }
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGOQKn7xnxLMMGrAqAGjBgwXAwBctnQfE4voQwAAAABJRU5ErkJggg==';
    return nativeImage.createFromDataURL(dataUrl);
}

function getServerHealthUrl() {
    const base = SERVER_URL.endsWith('/') ? SERVER_URL.slice(0, -1) : SERVER_URL;
    return `${base}/health`;
}

function checkServerOnce(timeoutMs) {
    return new Promise((resolve) => {
        const req = http.get(getServerHealthUrl(), { timeout: timeoutMs }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.on('error', () => resolve(false));
    });
}

async function waitForServerReady(maxWaitMs, intervalMs) {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
        if (await checkServerOnce(800)) return true;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
}

function resolveServerCandidate() {
    if (SERVER_PATH && fs.existsSync(SERVER_PATH)) {
        return { path: SERVER_PATH, type: SERVER_PATH.endsWith('.js') ? 'js' : 'exe' };
    }

    const candidates = [
        path.join(process.resourcesPath || '', 'server', 'OmniDropServer.exe'),
        path.join(process.resourcesPath || '', 'OmniDropServer.exe'),
        path.join(app.getAppPath(), '..', 'server', 'OmniDropServer.exe'),
        path.join(process.cwd(), 'server', 'OmniDropServer.exe'),
        path.join(process.cwd(), 'dist', 'server', 'OmniDropServer.exe'),
        path.join(app.getAppPath(), '..', 'server.js'),
        path.join(process.cwd(), 'server.js')
    ];

    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) {
            return { path: candidate, type: candidate.endsWith('.js') ? 'js' : 'exe' };
        }
    }

    return null;
}

function spawnServer() {
    const candidate = resolveServerCandidate();
    if (!candidate) {
        logPanel('server spawn failed: server not found (set OMNIDROP_SERVER_PATH)');
        return false;
    }

    logPanel(`server spawn: ${candidate.type} ${candidate.path}`);
    const env = { ...process.env, OMNIDROP_PANEL: 'none' };
    let child = null;

    if (candidate.type === 'js') {
        env.ELECTRON_RUN_AS_NODE = '1';
        child = spawn(process.execPath, [candidate.path, '--panel=none'], {
            detached: true,
            stdio: 'ignore',
            env,
            windowsHide: true
        });
    } else {
        child = spawn(candidate.path, ['--panel=none'], {
            detached: true,
            stdio: 'ignore',
            env,
            windowsHide: true
        });
    }

    child.on('error', (err) => logPanel(`server spawn error: ${err.message}`));
    child.on('exit', (code, signal) => logPanel(`server exit: code=${code} signal=${signal || 'none'}`));
    child.unref();
    serverProcess = child;
    return true;
}

async function ensureServerReady() {
    if (await checkServerOnce(800)) {
        logPanel('server already running');
        serverReady = true;
        return true;
    }

    logPanel('server not ready, starting...');
    if (!spawnServer()) return false;

    const ready = await waitForServerReady(8000, 300);
    serverReady = ready;
    logPanel(ready ? 'server ready' : 'server start timed out');
    return ready;
}

function loadPanelUrl() {
    if (!mainWindow) return;
    mainWindow.loadURL(SERVER_URL);
}

function createWindow() {
    const appIcon = getAppIconPath();
    mainWindow = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 960,
        minHeight: 640,
        show: false,
        autoHideMenuBar: true,
        icon: appIcon || undefined,
        webPreferences: {
            contextIsolation: true
        }
    });

    mainWindow.on('close', (event) => {
        if (!quitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.on('ready-to-show', () => {
        mainWindow.show();
    });

    const loadingHtml = 'data:text/html;charset=utf-8,' +
        encodeURIComponent('<!doctype html><html><body style=\"font-family:sans-serif;background:#f5f5f5;color:#333;display:flex;align-items:center;justify-content:center;height:100vh;\">OmniDrop is starting...</body></html>');
    mainWindow.loadURL(loadingHtml);
}

function ensureWindow() {
    if (!mainWindow) {
        createWindow();
    }
    if (serverReady && mainWindow) {
        loadPanelUrl();
    }
}

function showWindow() {
    ensureWindow();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function createTray() {
    tray = new Tray(getTrayIcon());
    tray.setToolTip('OmniDrop');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Panel', click: () => showWindow() },
        { label: 'Restart Service', click: () => restartServer() },
        { type: 'separator' },
        { label: 'Quit', click: () => appQuit() }
    ]));
    tray.on('click', () => showWindow());
    tray.on('double-click', () => showWindow());
}

function stopServerIfManaged() {
    if (!serverProcess || serverProcess.killed) return;
    try {
        serverProcess.kill();
        logPanel('server stop requested');
    } catch (e) {
        logPanel(`server stop error: ${e.message}`);
    }
}

async function restartServer() {
    if (serverProcess && !serverProcess.killed) {
        stopServerIfManaged();
        serverProcess = null;
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    spawnServer();
    await waitForServerReady(8000, 300);

    if (mainWindow) {
        mainWindow.loadURL(SERVER_URL);
    }
}

function appQuit() {
    quitting = true;
    stopServerIfManaged();
    app.quit();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        showWindow();
    });
}

app.on('before-quit', () => {
    quitting = true;
});

app.whenReady().then(async () => {
    logPanel(`panel start url=${SERVER_URL}`);
    createWindow();
    createTray();

    const ready = await ensureServerReady();
    if (ready && mainWindow) {
        loadPanelUrl();
        showWindow();
    } else {
        logPanel('panel load skipped: server not ready');
    }
});

app.on('activate', () => {
    showWindow();
});

