// better-sqlite3 is compiled against Electron's Node ABI (via electron-builder's
// `install-app-deps` postinstall step), so it can't be loaded by the system's
// plain Node.js binary — only by Electron itself running in Node-emulation mode
// (ELECTRON_RUN_AS_NODE=1). This wrapper resolves the Electron binary bundled
// in node_modules and re-execs vitest through it, so `npm test` works the same
// way locally and in CI without requiring a separate native rebuild step.
const { spawnSync } = require('child_process')
const path = require('path')

const electronPath = require('electron')
const vitestBin = path.join(__dirname, '..', 'node_modules', '.bin', 'vitest')

const result = spawnSync(electronPath, [vitestBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})

process.exit(result.status ?? 1)
