import { useCallback, useEffect, useState } from 'react'
import Sidebar, { type ViewId } from './components/Sidebar'
import CatalogView from './views/CatalogView'
import ManageModelsView from './views/ManageModelsView'
import ChatView from './views/ChatView'
import EmbeddingsView from './views/EmbeddingsView'
import TranscribeView from './views/TranscribeView'
import ServerView from './views/ServerView'
import type { EpStatus } from '@shared/types'

const EP_NAME_ALIASES: Record<string, string> = {
  WebGPUExecutionProvider: 'WebGpuExecutionProvider'
}

function normalizeEpName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9_]/g, '').trim()
  return EP_NAME_ALIASES[sanitized] ?? sanitized
}

function normalizeEps(epList: EpStatus[]): EpStatus[] {
  const merged = new Map<string, EpStatus>()
  for (const ep of epList) {
    const name = normalizeEpName(ep.name)
    if (!name) continue
    const existing = merged.get(name)
    if (!existing) {
      merged.set(name, { name, isRegistered: ep.isRegistered })
      continue
    }
    existing.isRegistered = existing.isRegistered || ep.isRegistered
  }
  return [...merged.values()]
}

function App(): React.JSX.Element {
  const [view, setView] = useState<ViewId>('catalog')
  const [eps, setEps] = useState<EpStatus[]>([])
  const [epsLoading, setEpsLoading] = useState(true)
  const [epRegistrationWarning, setEpRegistrationWarning] = useState<string | null>(null)

  const refreshEps = useCallback(async () => {
    const rawEpList = await window.api.foundry.discoverEps()
    const normalized = normalizeEps(rawEpList)
    setEps(normalized)
    return normalized
  }, [])

  useEffect(() => {
    let mounted = true

    async function run(): Promise<void> {
      const epList = await refreshEps()
      if (!mounted) return
      const hasUnregistered = epList.some((ep) => !ep.isRegistered)
      if (!hasUnregistered) return
      // Use SDK-side discovery/registration for "all EPs" because some
      // runtimes can report duplicate provider names that break explicit
      // name-based registration calls.
      try {
        const result = await window.api.foundry.registerEps()
        if (!mounted) return
        if (!result.success) {
          setEpRegistrationWarning(
            result.status || 'Some hardware acceleration providers could not be registered.'
          )
        }
        await refreshEps()
      } catch (err) {
        if (!mounted) return
        setEpRegistrationWarning(err instanceof Error ? err.message : String(err))
        console.error('Failed to auto-register execution providers', err)
      }
    }

    run()
      .catch((err) => {
        if (!mounted) return
        setEpRegistrationWarning(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (mounted) setEpsLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [refreshEps])

  return (
    <div className="app-shell">
      <Sidebar
        active={view}
        onChange={setView}
        eps={eps}
        epsLoading={epsLoading}
        epRegistrationWarning={epRegistrationWarning}
      />
      <main className="app-content">
        {view === 'catalog' && <CatalogView eps={eps} />}
        {view === 'manage' && <ManageModelsView />}
        {view === 'chat' && <ChatView />}
        {view === 'embeddings' && <EmbeddingsView />}
        {view === 'transcribe' && <TranscribeView />}
        {view === 'server' && <ServerView />}
      </main>
    </div>
  )
}

export default App
