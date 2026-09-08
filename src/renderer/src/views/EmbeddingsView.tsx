import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ModelSummary } from '@shared/types'
import { filterEmbeddingModels } from '../modelCategories'

const DEFAULT_TEXTS = [
  'The cat sat on the mat.',
  'A feline rested on the rug.',
  'The stock market fell sharply today.'
].join('\n')

function dotProduct(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

function magnitude(a: number[]): number {
  return Math.sqrt(dotProduct(a, a))
}

function cosineSimilarity(a: number[], b: number[]): number {
  const denom = magnitude(a) * magnitude(b)
  return denom === 0 ? 0 : dotProduct(a, b) / denom
}

function similarityColor(score: number): string {
  // 0 -> red-ish, 1 -> green-ish, clamped to [0, 1]
  const clamped = Math.max(0, Math.min(1, score))
  const hue = clamped * 120
  return `hsla(${hue}, 65%, 40%, ${0.25 + clamped * 0.45})`
}

function EmbeddingsView(): React.JSX.Element {
  const [loadedModels, setLoadedModels] = useState<ModelSummary[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [rawText, setRawText] = useState(DEFAULT_TEXTS)
  const [vectors, setVectors] = useState<number[][] | null>(null)
  const [labels, setLabels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshLoadedModels = useCallback(async () => {
    const all = await window.api.foundry.listModels()
    const loaded = filterEmbeddingModels(all.filter((m) => m.loaded))
    setLoadedModels(loaded)
    if (!selectedModelId && loaded.length > 0) setSelectedModelId(loaded[0].id)
  }, [selectedModelId])

  useEffect(() => {
    async function run(): Promise<void> {
      await refreshLoadedModels()
    }
    run().catch(() => {})
  }, [refreshLoadedModels])

  const texts = useMemo(
    () =>
      rawText
        .split('\n')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    [rawText]
  )

  const similarityMatrix = useMemo(() => {
    if (!vectors) return null
    return vectors.map((v1) => vectors.map((v2) => cosineSimilarity(v1, v2)))
  }, [vectors])

  async function handleGenerate(): Promise<void> {
    if (!selectedModelId || texts.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.embeddings.generate(selectedModelId, texts)
      setVectors(result)
      setLabels(texts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setVectors(null)
    } finally {
      setBusy(false)
    }
  }

  function truncate(s: string, max = 28): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s
  }

  return (
    <div className="view embeddings-view">
      <h2>Embeddings</h2>
      <p className="muted">
        Load an embeddings model in the Catalog tab, then enter one text per line below. This
        generates a vector per line and shows the pairwise cosine similarity between them — a quick
        way to sanity-check that semantically related lines score higher than unrelated ones.
      </p>

      <div className="embeddings-toolbar">
        <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
          {loadedModels.length === 0 && <option value="">No embedding models loaded</option>}
          {loadedModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        <button onClick={handleGenerate} disabled={!selectedModelId || texts.length === 0 || busy}>
          {busy ? 'Generating…' : 'Generate embeddings'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <textarea
        className="embeddings-input"
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="One text per line…"
        disabled={loadedModels.length === 0}
      />

      {vectors && similarityMatrix && (
        <div className="embeddings-results">
          <p className="muted">
            {vectors.length} vectors × {vectors[0]?.length ?? 0} dimensions
          </p>

          <div className="similarity-table-wrap">
            <table className="similarity-table">
              <thead>
                <tr>
                  <th />
                  {labels.map((l, i) => (
                    <th key={i} title={l}>
                      {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {similarityMatrix.map((row, i) => (
                  <tr key={i}>
                    <th title={labels[i]}>
                      {i + 1}. {truncate(labels[i])}
                    </th>
                    {row.map((score, j) => (
                      <td key={j} style={{ backgroundColor: similarityColor(score) }}>
                        {score.toFixed(3)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="embeddings-raw">
            <summary>Raw vector preview (first 8 dimensions)</summary>
            {vectors.map((v, i) => (
              <div key={i} className="embeddings-raw-row">
                <strong>{i + 1}.</strong> [
                {v
                  .slice(0, 8)
                  .map((n) => n.toFixed(4))
                  .join(', ')}
                {v.length > 8 ? ', …' : ''}]
              </div>
            ))}
          </details>
        </div>
      )}
    </div>
  )
}

export default EmbeddingsView
