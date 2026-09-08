export function normalizeIpcError(error: unknown): Error {
  let message = error instanceof Error ? error.message : String(error)
  message = message.replace(/^Error invoking remote method '[^']+':\s*/i, '')

  if (
    message.includes(
      'FoundryLocalCorePath not specified in configuration and could not auto-discover binaries'
    )
  ) {
    message =
      'Foundry Local native libraries are missing. Fix: 1) close the app, 2) run "npm install", 3) if it still fails run "npm rebuild foundry-local-sdk foundry-local-sdk-winml --foreground-scripts", 4) restart the app. If install/rebuild fails, use Node.js 22 LTS and retry.'
  }

  return new Error(message)
}
