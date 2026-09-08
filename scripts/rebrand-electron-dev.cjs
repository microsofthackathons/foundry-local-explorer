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
    try {
        execFileSync('plutil', ['-replace', key, '-string', value, plistPath]);
    } catch (err) {
        // Don't let a cosmetic dev-mode branding failure (e.g. plutil
        // missing, plist unwritable/malformed) abort the whole
        // `npm install`/postinstall chain and block dependency setup.
        console.warn(
            `[foundry-local-explorer] Could not set ${key} on the dev Electron.app bundle (non-fatal; ` +
                'the app may still show "Electron" in the Dock/menu bar in dev mode):',
            err instanceof Error ? err.message : err
        );
    }
}

// macOS's Launch Services caches bundle metadata (name, bundle id, icon)
// keyed by path, separately from the Info.plist itself. Without forcing a
// re-scan here, the Dock tooltip and Cmd+Tab switcher can keep showing the
// stale "Electron" name even though Info.plist has already been patched,
// until something else (e.g. a Finder relaunch or reboot) happens to
// trigger Launch Services to notice the change on its own.
const lsregister =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const appBundlePath = path.join(plistPath, '..', '..');
try {
    execFileSync(lsregister, ['-f', appBundlePath]);
} catch (err) {
    console.warn(
        '[foundry-local-explorer] Could not refresh Launch Services registration for the dev Electron.app bundle ' +
            '(non-fatal; the Dock/menu-bar name may still show "Electron" until next reboot or Finder relaunch):',
        err instanceof Error ? err.message : err
    );
}

console.log(`[foundry-local-explorer] Rebranded dev Electron.app bundle as "${APP_NAME}".`);
