import type { EpStatus } from '@shared/types'

interface Props {
  eps: EpStatus[]
  loading: boolean
  registrationWarning: string | null
}

const DEVICE_HINTS: Record<string, string> = {
  CUDAExecutionProvider: 'NVIDIA GPU',
  NvTensorRTRTXExecutionProvider: 'NVIDIA GPU (TensorRT)',
  WebGpuExecutionProvider: 'GPU (WebGPU)',
  QNNExecutionProvider: 'Qualcomm NPU',
  OpenVINOExecutionProvider: 'Intel CPU/GPU/NPU',
  VitisAIExecutionProvider: 'AMD NPU',
  CPUExecutionProvider: 'CPU'
}

function HardwarePanel({ eps, loading, registrationWarning }: Props): React.JSX.Element {
  return (
    <div className="hardware-panel">
      <h3 className="hardware-panel-title">Hardware acceleration</h3>
      {loading && <p className="muted">Detecting execution providers…</p>}
      {!loading && registrationWarning && <p className="ep-warning">{registrationWarning}</p>}
      {!loading && eps.length === 0 && <p className="muted">No execution providers detected.</p>}
      <ul className="ep-list">
        {eps.map((ep, idx) => (
          <li
            key={`${ep.name}-${idx}`}
            className={ep.isRegistered ? 'ep-registered' : 'ep-available'}
          >
            <div className="ep-row">
              <span className={`status-dot ${ep.isRegistered ? 'on' : 'off'}`} />
              <span className="ep-name">{ep.name}</span>
            </div>
            <div className="ep-row">
              <span className="ep-hint">{DEVICE_HINTS[ep.name] ?? ''}</span>
              <span className="ep-state">{ep.isRegistered ? 'Registered' : 'Not registered'}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default HardwarePanel
