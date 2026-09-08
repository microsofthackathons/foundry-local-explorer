// Copyright (c) contributors to Foundry Local Explorer.
//
// When running unpackaged (i.e. `npm run dev`), macOS derives the running
// app's identity shown in the global menu bar, Dock, and Cmd+Tab switcher
// from the local `node_modules/electron/dist/Electron.app` bundle's own
// Info.plist — not from any Electron JS API (`app.setName()` etc. have no
// effect on this). That bundle ships with CFBundleName/CFBundleDisplayName
// hardcoded to "Electron", so without this patch the dev build always
// appears as "Electron" in the menus, regardless of app-level branding.
//
// This only matters for local development: packaged builds (`npm run
// build:mac`) are already correctly renamed by electron-builder using
// `productName` in electron-builder.yml.
//
// Safe to run repeatedly and safe to skip if Electron hasn't been
// installed yet (postinstall ordering) or on non-macOS platforms.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') {
    process.exit(0);
}

const plistPath = path.join(
    __dirname,
    '..',
    'node_modules',
    'electron',
    'dist',
    'Electron.app',
    'Contents',
    'Info.plist'
);

if (!fs.existsSync(plistPath)) {
    // Electron's own binary hasn't been downloaded/extracted yet (e.g. this
    // ran before `electron`'s install script, or in an environment without
    // the native binary at all). Nothing to patch.
    process.exit(0);
}

const APP_NAME = 'Foundry Local Explorer';
const BUNDLE_ID = 'com.foundrylocalexplorer.app';

// Note: CFBundleExecutable is deliberately left untouched — it must keep
// matching the actual binary file name on disk (Electron.app/Contents/MacOS/Electron).
const replacements = [
    ['CFBundleName', APP_NAME],
    ['CFBundleDisplayName', APP_NAME],
    ['CFBundleIdentifier', BUNDLE_ID],
];

for (const [key, value] of replacements) {
    execFileSync('plutil', ['-replace', key, '-string', value, plistPath]);
}

console.log(`[foundry-local-explorer] Rebranded dev Electron.app bundle as "${APP_NAME}".`);
