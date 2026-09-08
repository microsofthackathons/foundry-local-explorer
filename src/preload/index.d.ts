import type {
  ChatChunkEvent,
  ChatSendRequest,
  ConversationSummary,
  DocumentSummary,
  DownloadProgressEvent,
  EpRegisterProgressEvent,
  EpRegisterResult,
  EpStatus,
  IngestResult,
  ModelSummary,
  ServerStatus,
  StoredMessage,
  TranscribeFromBufferRequest,
  TranscribeChunkEvent,
  TranscribeSendRequest
} from '@shared/types'

export interface FlStudioApi {
  foundry: {
    listModels: () => Promise<ModelSummary[]>
    discoverEps: () => Promise<EpStatus[]>
    registerEps: (names?: string[]) => Promise<EpRegisterResult>
    cancelRegisterEps: (names?: string[]) => Promise<{ ok: true }>
    downloadModel: (modelId: string) => Promise<{ ok: true }>
    cancelDownload: (modelId: string) => Promise<{ ok: true }>
    loadModel: (modelId: string) => Promise<void>
    unloadModel: (modelId: string) => Promise<void>
    deleteModel: (modelId: string) => Promise<void>
    startServer: () => Promise<ServerStatus>
    stopServer: () => Promise<ServerStatus>
    serverStatus: () => Promise<ServerStatus>
    onDownloadProgress: (callback: (event: DownloadProgressEvent) => void) => () => void
    onEpRegisterProgress: (callback: (event: EpRegisterProgressEvent) => void) => () => void
  }
  chat: {
    send: (request: ChatSendRequest) => Promise<{ ok: true; content: string; ragWarning?: string }>
    stop: (requestId: string) => Promise<{ ok: true }>
    onChunk: (callback: (event: ChatChunkEvent) => void) => () => void
  }
  history: {
    listConversations: () => Promise<ConversationSummary[]>
    createConversation: (modelId: string, title: string) => Promise<ConversationSummary>
    getMessages: (conversationId: string) => Promise<StoredMessage[]>
    renameConversation: (conversationId: string, title: string) => Promise<void>
    deleteConversation: (conversationId: string) => Promise<void>
  }
  rag: {
    ingestFile: (
      conversationId: string,
      filePath: string,
      embedModelId: string
    ) => Promise<IngestResult>
    listDocuments: (conversationId: string) => Promise<DocumentSummary[]>
    removeDocument: (conversationId: string, documentId: string) => Promise<void>
  }
  embeddings: {
    generate: (modelId: string, texts: string[]) => Promise<number[][]>
  }
  audio: {
    transcribe: (request: TranscribeSendRequest) => Promise<{ ok: true; text: string }>
    transcribeFromBuffer: (
      request: TranscribeFromBufferRequest
    ) => Promise<{ ok: true; text: string }>
    stop: (requestId: string) => Promise<{ ok: true }>
    onChunk: (callback: (event: TranscribeChunkEvent) => void) => () => void
  }
  getPathForFile: (file: File) => string
}

declare global {
  interface Window {
    api: FlStudioApi
  }
}
