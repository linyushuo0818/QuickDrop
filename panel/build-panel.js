const fs = require('fs');
const path = require('path');

const root = process.cwd();
const unpackedDir = path.join(root, 'dist', 'app', 'win-unpacked');
const panelDir = path.join(root, 'dist', 'app');
const tempDir = path.join(root, 'dist', 'app_temp');
const sourceExeCandidates = ['OmniDrop.exe', 'OmniDropPanel.exe'];
const sourceExe = sourceExeCandidates
    .map((name) => path.join(unpackedDir, name))
    .find((candidate) => fs.existsSync(candidate));
if (!sourceExe) {
    throw new Error(`panel exe missing: ${path.join(unpackedDir, '{OmniDrop.exe|OmniDropPanel.exe}')}`);
}
const sourceResources = path.join(unpackedDir, 'resources');
const targetExe = path.join(panelDir, 'OmniDrop.exe');
const targetResources = path.join(panelDir, 'resources');

function ensureExists(target, label) {
    if (!fs.existsSync(target)) {
        throw new Error(`${label} missing: ${target}`);
    }
}

function removeIfExists(target) {
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
}

ensureExists(unpackedDir, 'unpacked dir');
ensureExists(sourceExe, 'panel exe');
ensureExists(sourceResources, 'panel resources');

removeIfExists(tempDir);
fs.mkdirSync(tempDir, { recursive: true });
fs.cpSync(unpackedDir, tempDir, { recursive: true });

removeIfExists(panelDir);
fs.renameSync(tempDir, panelDir);

if (fs.existsSync(path.join(panelDir, 'OmniDropPanel.exe'))) {
    fs.renameSync(path.join(panelDir, 'OmniDropPanel.exe'), targetExe);
}
ensureExists(targetExe, 'panel exe');
ensureExists(targetResources, 'panel resources');

removeIfExists(path.join(panelDir, 'builder-debug.yml'));

console.log('[panel-build] output ready: dist/app/OmniDrop.exe + dist/app/resources');
