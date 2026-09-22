import type { ModelSummary } from '@shared/types'
import { formatSize } from '../utils/formatSize'

interface Props {
  model: ModelSummary
  matchesHardware: boolean
  loadable: boolean
  isLoading?: boolean
  downloadProgress?: number
  onDownload: (modelId: string) => void
  onLoad: (modelId: string) => void
  onUnload: (modelId: string) => void
  onDelete: (modelId: string) => void
}

function ModelCard({
  model,
  matchesHardware,
  loadable,
  isLoading,
  downloadProgress,
  onDownload,
  onLoad,
  onUnload,
  onDelete
}: Props): React.JSX.Element {
  const isDownloading = downloadProgress !== undefined && downloadProgress < 100

  return (
    <div className="model-card">
      <div className="model-card-header">
        <span className="model-name">{model.displayName}</span>
        {matchesHardware && <span className="badge badge-hw">Recommended for your hardware</span>}
      </div>
      <div className="model-meta">
        <span>{model.alias}</span>
        <span>{model.task ?? 'unknown task'}</span>
        <span>{model.deviceType ?? '—'}</span>
        <span>{formatSize(model.fileSizeMb)}</span>
      </div>
      {model.publisher && <div className="model-publisher">by {model.publisher}</div>}
      <div className="model-actions">
        {!model.cached && !isDownloading && (
          <button onClick={() => onDownload(model.id)}>Download</button>
        )}
        {isDownloading && (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${downloadProgress}%` }} />
            <span className="progress-label">{downloadProgress?.toFixed(0)}%</span>
          </div>
        )}
        {model.cached && !model.loaded && loadable && (
          <button disabled={isLoading} onClick={() => onLoad(model.id)}>
            {isLoading ? 'Loading…' : 'Load'}
          </button>
        )}
        {model.loaded && (
          <>
            <span className="badge badge-loaded">Loaded</span>
            <button onClick={() => onUnload(model.id)}>Unload</button>
          </>
        )}
        {model.cached && (
          <button className="danger-btn" onClick={() => onDelete(model.id)}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

export default ModelCard
