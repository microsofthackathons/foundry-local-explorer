import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelSummary } from '@shared/types'
import { filterTranscriptionModels } from '../modelCategories'

function pickSupportedMimeType(): string {
  const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
  for (const mime of preferred) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ''
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mp4') || mimeType.includes('mpeg') || mimeType.includes('aac'))
    return 'm4a'
  return 'webm'
}

function pcm16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
}

function encodeWav(audioBuffer: AudioBuffer): Uint8Array {
  const channels = audioBuffer.numberOfChannels
  const sampleRate = audioBuffer.sampleRate
  const frameCount = audioBuffer.length
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const dataSize = frameCount * blockAlign
  const wavSize = 44 + dataSize
  const arrayBuffer = new ArrayBuffer(wavSize)
  const view = new DataView(arrayBuffer)

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  const channelData: Float32Array[] = []
  for (let c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c))
  for (let i = 0; i < frameCount; i++) {
    for (let c = 0; c < channels; c++) {
      view.setInt16(offset, pcm16(channelData[c][i]), true)
      offset += bytesPerSample
    }
  }

  return new Uint8Array(arrayBuffer)
}

async function convertBlobToWavBytes(blob: Blob): Promise<Uint8Array> {
  const raw = await blob.arrayBuffer()
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(raw.slice(0))
    return encodeWav(decoded)
  } finally {
    await context.close()
  }
}

function TranscribeView(): React.JSX.Element {
  const [loadedModels, setLoadedModels] = useState<ModelSummary[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [microphones, setMicrophones] = useState<{ id: string; label: string }[]>([])
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string>('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isMicRecording, setIsMicRecording] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestIdRef = useRef<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const micChunksRef = useRef<BlobPart[]>([])

  const refreshLoadedModels = useCallback(async () => {
    const all = await window.api.foundry.listModels()
    const loaded = filterTranscriptionModels(all.filter((m) => m.loaded))
    setLoadedModels(loaded)
    if (!selectedModelId && loaded.length > 0) setSelectedModelId(loaded[0].id)
  }, [selectedModelId])

  useEffect(() => {
    async function run(): Promise<void> {
      await refreshLoadedModels()
    }
    run().catch(() => {})
  }, [refreshLoadedModels])

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices?.enumerateDevices) return

    let cancelled = false

    const refreshMicrophones = async (): Promise<void> => {
      try {
        const devices = await mediaDevices.enumerateDevices()
        if (cancelled) return
        const inputs = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, idx) => ({
            id: d.deviceId,
            label: d.label || `Microphone ${idx + 1}`
          }))
        setMicrophones(inputs)

        if (inputs.length === 0) {
          setSelectedMicrophoneId('')
          return
        }

        setSelectedMicrophoneId((prev) =>
          prev && inputs.some((input) => input.id === prev) ? prev : inputs[0].id
        )
      } catch {
        if (!cancelled) {
          setMicrophones([])
          setSelectedMicrophoneId('')
        }
      }
    }

    refreshMicrophones()
    mediaDevices.addEventListener('devicechange', refreshMicrophones)

    return () => {
      cancelled = true
      mediaDevices.removeEventListener('devicechange', refreshMicrophones)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.audio.onChunk(({ requestId, delta, done, error: err }) => {
      if (requestId !== requestIdRef.current) return
      if (delta) setTranscript((prev) => prev + delta)
      if (done) {
        setIsTranscribing(false)
        requestIdRef.current = null
        if (err) setError(err)
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop()
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  function pickFile(file: File): void {
    setFilePath(window.api.getPathForFile(file))
    setFileName(file.name)
    setTranscript('')
    setError(null)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) pickFile(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (file) pickFile(file)
    e.target.value = ''
  }

  async function handleTranscribe(): Promise<void> {
    if (!filePath || !selectedModelId || isTranscribing || isMicRecording) return
    setError(null)
    setTranscript('')

    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    setIsTranscribing(true)

    try {
      await window.api.audio.transcribe({ requestId, modelId: selectedModelId, filePath })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsTranscribing(false)
    }
  }

  function handleStop(): void {
    if (isMicRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      return
    }
    if (requestIdRef.current) window.api.audio.stop(requestIdRef.current)
  }

  async function transcribeMicrophoneBlob(blob: Blob): Promise<void> {
    if (!selectedModelId) {
      setError('Pick a transcription model before using the microphone.')
      return
    }
    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    setError(null)
    setTranscript('')
    setIsTranscribing(true)

    try {
      let bytes: Uint8Array
      let mimeType = blob.type || 'audio/webm'
      let ext = extensionForMimeType(mimeType)
      try {
        bytes = await convertBlobToWavBytes(blob)
        mimeType = 'audio/wav'
        ext = 'wav'
      } catch {
        bytes = new Uint8Array(await blob.arrayBuffer())
      }

      const fileName = `microphone-${Date.now()}.${ext}`
      await window.api.audio.transcribeFromBuffer({
        requestId,
        modelId: selectedModelId,
        fileName,
        mimeType,
        audioBytes: bytes
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsTranscribing(false)
      requestIdRef.current = null
    }
  }

  async function handleMicrophoneClick(): Promise<void> {
    if (isTranscribing) {
      setError('Wait for the current transcription to finish before starting microphone capture.')
      return
    }

    if (isMicRecording) {
      mediaRecorderRef.current?.stop()
      return
    }

    if (microphones.length === 0) {
      setError('No microphone input found on this system.')
      return
    }

    if (!selectedModelId) {
      setError('Pick a transcription model before recording.')
      return
    }

    const constraints: MediaStreamConstraints = {
      audio: selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : true
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      const mimeType = pickSupportedMimeType()
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      micChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) micChunksRef.current.push(event.data)
      }

      recorder.onerror = () => {
        setError('Microphone recording failed. Please check microphone permissions and try again.')
        setIsMicRecording(false)
      }

      recorder.onstop = async () => {
        setIsMicRecording(false)
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null

        const chunks = micChunksRef.current
        micChunksRef.current = []
        if (chunks.length === 0) {
          setError('No audio captured from microphone. Please try again.')
          return
        }

        const chunkMimeType = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type: chunkMimeType })
        await transcribeMicrophoneBlob(blob)
      }

      recorder.start(300)
      setError(null)
      setIsMicRecording(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start microphone recording.')
      setIsMicRecording(false)
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      mediaRecorderRef.current = null
    }
  }

  return (
    <div className="view transcribe-view">
      <h2>Transcribe</h2>
      <select
        className="transcribe-model-select"
        value={selectedModelId}
        onChange={(e) => setSelectedModelId(e.target.value)}
      >
        {loadedModels.length === 0 && <option value="">No transcription models loaded</option>}
        {loadedModels.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName}
          </option>
        ))}
      </select>
      <p className="muted">
        Load a speech-to-text model (e.g. a Whisper variant) in the Catalog tab, then drop or pick
        an audio file below to test its transcription quality.
      </p>

      <div className="transcribe-toolbar">
        <div
          className={`transcribe-dropzone transcribe-dropzone-inline ${isDragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragOver(true)
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          {fileName ? (
            <span>🎵 {fileName}</span>
          ) : (
            <span className="muted">Drag audio file here</span>
          )}
        </div>
        <label className="file-picker-btn">
          Choose audio file…
          <input type="file" accept="audio/*" onChange={handleFileInput} hidden />
        </label>
        {isTranscribing ? (
          <button className="stop-btn" onClick={handleStop}>
            Stop
          </button>
        ) : (
          <button
            onClick={handleTranscribe}
            disabled={!filePath || !selectedModelId || isMicRecording}
          >
            Transcribe
          </button>
        )}
        <span className="toolbar-divider" aria-hidden="true" />
        <select
          className="mic-select"
          value={selectedMicrophoneId}
          onChange={(e) => setSelectedMicrophoneId(e.target.value)}
          disabled={microphones.length === 0 || isTranscribing || isMicRecording}
          title="Select microphone input device"
        >
          {microphones.length === 0 && <option value="">No microphone found</option>}
          {microphones.map((mic) => (
            <option key={mic.id} value={mic.id}>
              {mic.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`mic-btn ${isMicRecording ? 'recording' : ''}`}
          onClick={handleMicrophoneClick}
          disabled={isTranscribing}
          title={isMicRecording ? 'Stop microphone recording' : 'Start microphone recording'}
        >
          {isMicRecording ? '⏹️' : '🎙️'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <textarea
        className="transcribe-output"
        value={transcript}
        readOnly
        placeholder={isTranscribing ? 'Transcribing…' : 'Transcript will appear here…'}
      />
    </div>
  )
}

export default TranscribeView
