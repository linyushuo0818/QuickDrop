const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const rootDir = path.join(__dirname, '..');
const sourcePng = path.join(rootDir, 'airdrop.png');
const assetsDir = path.join(__dirname, 'assets');
const trayPng = path.join(assetsDir, 'tray.png');
const iconIco = path.join(assetsDir, 'icon.ico');

if (!fs.existsSync(sourcePng)) {
    console.error(`[icon] missing source png: ${sourcePng}`);
    process.exit(1);
}

if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
}

fs.copyFileSync(sourcePng, trayPng);

pngToIco(sourcePng)
    .then((buffer) => {
        fs.writeFileSync(iconIco, buffer);
        console.log(`[icon] tray updated: ${trayPng}`);
        console.log(`[icon] ico generated: ${iconIco}`);
    })
    .catch((error) => {
        console.error('[icon] failed to generate ico:', error.message || error);
        process.exit(1);
    });
