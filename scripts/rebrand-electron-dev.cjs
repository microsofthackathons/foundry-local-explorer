// Copyright (c) contributors to Foundry Local Explorer.
//
// When running unpackaged (i.e. `npm run dev`), macOS derives the running
// app's identity shown in the global menu bar, Dock, and Cmd+Tab switcher
// from the local `node_modules/electron/dist/Electron.app` bundle itself —
// not from any Electron JS API (`app.setName()` etc. have no effect on
// this). That bundle ships as "Electron.app" with CFBundleName/
// CFBundleDisplayName/CFBundleIdentifier and an ad-hoc code signature
// identifier all hardcoded to "Electron"/"com.github.Electron", so without
// this patch the dev build always appears as "Electron" everywhere,
// regardless of app-level branding.
//
// Getting every surface to show the real name requires four changes, in
// this order (verified empirically on macOS 26 / Electron 39):
//   1. Rename the bundle folder itself (Electron.app -> "<name>.app") and
//      update node_modules/electron/path.txt to match — the Dock's own
//      tooltip cache keys off the bundle folder name, not just Info.plist.
//   2. Patch CFBundleName/CFBundleDisplayName/CFBundleIdentifier in
//      Info.plist (drives the menu bar and window title).
//   3. Re-sign the bundle with an ad-hoc signature whose identifier
//      matches the new bundle id — modifying Info.plist invalidates
//      Electron's original ad-hoc signature, and the signature's baked-in
//      Identifier is a separate value from Info.plist that some macOS
//      surfaces also consult.
//   4. Force Launch Services to re-scan the bundle (`lsregister -f`) so
//      its cached metadata (separate from both Info.plist and the Dock's
//      own cache) doesn't keep serving the stale "Electron" identity.
//
// This only matters for local development: packaged builds (`npm run
// build:mac`) are already correctly branded by electron-builder using
// `productName`/`appId` in electron-builder.yml.
//
// Safe to run repeatedly (idempotent) and safe to skip if Electron hasn't
// been installed yet (postinstall ordering) or on non-macOS platforms.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'darwin') {
    process.exit(0);
}

const APP_NAME = 'Foundry Local Explorer';
const BUNDLE_ID = 'com.foundrylocalexplorer.app';

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const distDir = path.join(electronDir, 'dist');
const oldBundlePath = path.join(distDir, 'Electron.app');
const newBundlePath = path.join(distDir, `${APP_NAME}.app`);
const pathTxt = path.join(electronDir, 'path.txt');

// Determine the bundle's current location: it may already be renamed from a
// previous run of this script, or still be the pristine "Electron.app".
let bundlePath;
if (fs.existsSync(newBundlePath)) {
    bundlePath = newBundlePath;
} else if (fs.existsSync(oldBundlePath)) {
    bundlePath = oldBundlePath;
} else {
    // Electron's own binary hasn't been downloaded/extracted yet (e.g. this
    // ran before `electron`'s install script, or in an environment without
    // the native binary at all). Nothing to patch.
    process.exit(0);
}

// Step 1: rename the bundle folder and update electron's own path.txt,
// which is how the `electron` npm package locates the binary
// (see node_modules/electron/index.js).
if (bundlePath !== newBundlePath) {
    try {
        fs.renameSync(bundlePath, newBundlePath);
        bundlePath = newBundlePath;
        fs.writeFileSync(pathTxt, `${APP_NAME}.app/Contents/MacOS/Electron`);
    } catch (err) {
        console.warn(
            '[foundry-local-explorer] Could not rename the dev Electron.app bundle (non-fatal; the app may still ' +
                'show "Electron" in the Dock in dev mode):',
            err instanceof Error ? err.message : err
        );
    }
}

const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');

if (!fs.existsSync(plistPath)) {
    process.exit(0);
}

// Step 2: patch Info.plist. CFBundleExecutable is deliberately left
// untouched — it must keep matching the actual binary file name on disk
// (<bundle>.app/Contents/MacOS/Electron).
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

// Step 3: re-sign with an ad-hoc signature carrying the new identifier.
// Editing Info.plist invalidates Electron's original ad-hoc signature, and
// the signature's own Identifier field is independent of CFBundleIdentifier.
try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', BUNDLE_ID, bundlePath]);
} catch (err) {
    console.warn(
        '[foundry-local-explorer] Could not re-sign the dev Electron.app bundle after rebranding (non-fatal, but ' +
            'the app may fail to launch or show security prompts until this is resolved):',
        err instanceof Error ? err.message : err
    );
}

// Step 4: macOS's Launch Services caches bundle metadata (name, bundle id,
// icon) keyed by path, separately from Info.plist and the code signature.
// Without forcing a re-scan here, some surfaces (e.g. Cmd+Tab) can keep
// showing the stale "Electron" name until something else happens to
// trigger Launch Services to notice the change on its own.
const lsregister =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
try {
    execFileSync(lsregister, ['-f', bundlePath]);
} catch (err) {
    console.warn(
        '[foundry-local-explorer] Could not refresh Launch Services registration for the dev Electron.app bundle ' +
            '(non-fatal; the Dock/menu-bar name may still show "Electron" until next reboot or Finder relaunch):',
        err instanceof Error ? err.message : err
    );
}

console.log(`[foundry-local-explorer] Rebranded dev Electron.app bundle as "${APP_NAME}".`);
