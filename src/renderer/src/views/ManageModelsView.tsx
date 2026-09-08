import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EpStatus, ModelSummary } from '@shared/types'
import ModelCard from '../components/ModelCard'
import { formatSize } from '../utils/formatSize'
import { MODEL_CATEGORY_LABELS, getModelCategory } from '../modelCategories'
import type { ModelCategory } from '../modelCategories'

const CATEGORY_ORDER: ModelCategory[] = ['chat', 'embedding', 'transcription']

/**
 * Lists only the models that are already downloaded (cached) locally, so the
 * user can load/unload/delete them without wading through the full browsable
 * catalog (that's what the Catalog tab is for).
 */
function ManageModelsView(): React.JSX.Element {
  const [models, setModels] = useState<ModelSummary[]>([])
  const [eps, setEps] = useState<EpStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null)

  const refreshModels = useCallback(async () => {
    const list = await window.api.foundry.listModels()
    setModels(list)
  }, [])

  useEffect(() => {
    let mounted = true
    Promise.all([window.api.foundry.listModels(), window.api.foundry.discoverEps()])
      .then(([modelList, epList]) => {
        if (!mounted) return
        setModels(modelList)
        setEps(epList)
      })
      .catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  const registeredEps = useMemo(
    () => new Set(eps.filter((e) => e.isRegistered).map((e) => e.name)),
    [eps]
  )

  const cachedModels = useMemo(() => {
    return models.filter((m) => {
      if (!m.cached) return false
      if (search && !m.alias.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [models, search])

  const groupedModels = useMemo(() => {
    const groups = new Map<ModelCategory, ModelSummary[]>()
    for (const m of cachedModels) {
      const category = getModelCategory(m)
      const group = groups.get(category)
      if (group) group.push(m)
      else groups.set(category, [m])
    }
    return CATEGORY_ORDER.map((category) => ({
      category,
      models: groups.get(category) ?? []
    })).filter((g) => g.models.length > 0)
  }, [cachedModels])

  // Totals are computed from the full model list (not the search-filtered
  // cachedModels) so the summary doesn't change while the user is typing.
  const diskUsageMb = useMemo(
    () => models.filter((m) => m.cached).reduce((sum, m) => sum + (m.fileSizeMb ?? 0), 0),
    [models]
  )
  const memoryUsageMb = useMemo(
    () => models.filter((m) => m.loaded).reduce((sum, m) => sum + (m.fileSizeMb ?? 0), 0),
    [models]
  )

  // Same rules as the Catalog tab: CPU is the universal fallback (never
  // "recommended"), accelerator variants need their EP registered to load.
  function matchesHardware(m: ModelSummary): boolean {
    if (m.deviceType === 'CPU') return false
    if (!m.executionProvider) return false
    return registeredEps.has(m.executionProvider)
  }

  function isLoadable(m: ModelSummary): boolean {
    if (m.deviceType === 'CPU') return true
    if (!m.executionProvider) return false
    return registeredEps.has(m.executionProvider)
  }

  async function handleLoad(modelId: string): Promise<void> {
    setLoadingModelId(modelId)
    try {
      await window.api.foundry.loadModel(modelId)
      await refreshModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingModelId(null)
    }
  }

  async function handleUnload(modelId: string): Promise<void> {
    try {
      await window.api.foundry.unloadModel(modelId)
      await refreshModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDelete(modelId: string): Promise<void> {
    try {
      await window.api.foundry.deleteModel(modelId)
      await refreshModels()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="view manage-view">
      <h2>Manage Models</h2>
      <p className="muted">
        Models you&apos;ve already downloaded. Load, unload, or delete them here — use the Catalog
        tab to download more.
      </p>
      <p className="muted model-usage-summary">
        Disk space used: <strong>{formatSize(diskUsageMb)}</strong> · Memory used by loaded models:{' '}
        <strong>{formatSize(memoryUsageMb)}</strong>
      </p>

      <input
        placeholder="Search downloaded models…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      {groupedModels.map(({ category, models: groupModels }) => (
        <section key={category} className="model-category-group">
          <h3 className="model-category-heading">{MODEL_CATEGORY_LABELS[category]}</h3>
          <div className="model-grid">
            {groupModels.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                matchesHardware={matchesHardware(m)}
                loadable={isLoadable(m)}
                isLoading={loadingModelId === m.id}
                onDownload={() => {}}
                onLoad={handleLoad}
                onUnload={handleUnload}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      ))}
      {!loading && cachedModels.length === 0 && (
        <p className="muted">No downloaded models yet. Go to the Catalog tab to download one.</p>
      )}
    </div>
  )
}

export default ManageModelsView
