const fs = require('fs');
const path = require('path');

const root = process.cwd();
const distDir = path.join(root, 'dist');
const serverDir = path.join(distDir, 'server');
const outputExe = path.join(serverDir, 'OmniDropServer.exe');

function ensureDir(target) {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }
}

function moveIfExists(sourcePath) {
    if (!fs.existsSync(sourcePath)) return false;
    ensureDir(serverDir);
    if (fs.existsSync(outputExe)) {
        fs.rmSync(outputExe, { force: true });
    }
    fs.renameSync(sourcePath, outputExe);
    return true;
}

const candidates = [
    path.join(distDir, 'lan-clipboard.exe'),
    path.join(distDir, 'OmniDropServer.exe')
];

let moved = false;
for (const candidate of candidates) {
    if (moveIfExists(candidate)) {
        moved = true;
        break;
    }
}

if (!moved) {
    throw new Error('Server build output not found in dist.');
}

console.log('[server-build] output ready: dist/server/OmniDropServer.exe');
