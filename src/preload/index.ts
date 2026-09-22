import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ChatChunkEvent,
  ChatSendRequest,
  DownloadProgressEvent,
  EpRegisterProgressEvent,
  TranscribeFromBufferRequest,
  TranscribeChunkEvent,
  TranscribeSendRequest
} from '@shared/types'

function normalizeIpcError(error: unknown): Error {
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

async function invokeIpc<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (error) {
    throw normalizeIpcError(error)
  }
}

// Custom APIs for renderer
const api = {
  foundry: {
    listModels: () => invokeIpc('foundry:listModels'),
    discoverEps: () => invokeIpc('foundry:discoverEps'),
    registerEps: (names?: string[]) => invokeIpc('foundry:registerEps', names),
    cancelRegisterEps: (names?: string[]) => invokeIpc('foundry:cancelRegisterEps', names),
    downloadModel: (modelId: string) => invokeIpc('foundry:downloadModel', modelId),
    cancelDownload: (modelId: string) => invokeIpc('foundry:cancelDownload', modelId),
    loadModel: (modelId: string) => invokeIpc('foundry:loadModel', modelId),
    unloadModel: (modelId: string) => invokeIpc('foundry:unloadModel', modelId),
    deleteModel: (modelId: string) => invokeIpc('foundry:deleteModel', modelId),
    startServer: () => invokeIpc('foundry:startServer'),
    stopServer: () => invokeIpc('foundry:stopServer'),
    serverStatus: () => invokeIpc('foundry:serverStatus'),
    onDownloadProgress: (callback: (event: DownloadProgressEvent) => void) => {
      const listener = (_e: unknown, data: DownloadProgressEvent): void => callback(data)
      ipcRenderer.on('foundry:downloadProgress', listener)
      return () => ipcRenderer.removeListener('foundry:downloadProgress', listener)
    },
    onEpRegisterProgress: (callback: (event: EpRegisterProgressEvent) => void) => {
      const listener = (_e: unknown, data: EpRegisterProgressEvent): void => callback(data)
      ipcRenderer.on('foundry:epRegisterProgress', listener)
      return () => ipcRenderer.removeListener('foundry:epRegisterProgress', listener)
    }
  },
  chat: {
    send: (request: ChatSendRequest) => ipcRenderer.invoke('chat:send', request),
    stop: (requestId: string) => ipcRenderer.invoke('chat:stop', requestId),
    onChunk: (callback: (event: ChatChunkEvent) => void) => {
      const listener = (_e: unknown, data: ChatChunkEvent): void => callback(data)
      ipcRenderer.on('chat:chunk', listener)
      return () => ipcRenderer.removeListener('chat:chunk', listener)
    }
  },
  history: {
    listConversations: () => ipcRenderer.invoke('history:listConversations'),
    createConversation: (modelId: string, title: string) =>
      ipcRenderer.invoke('history:createConversation', modelId, title),
    getMessages: (conversationId: string) =>
      ipcRenderer.invoke('history:getMessages', conversationId),
    renameConversation: (conversationId: string, title: string) =>
      ipcRenderer.invoke('history:renameConversation', conversationId, title),
    deleteConversation: (conversationId: string) =>
      ipcRenderer.invoke('history:deleteConversation', conversationId)
  },
  rag: {
    ingestFile: (conversationId: string, filePath: string, embedModelId: string) =>
      ipcRenderer.invoke('rag:ingestFile', conversationId, filePath, embedModelId),
    listDocuments: (conversationId: string) =>
      ipcRenderer.invoke('rag:listDocuments', conversationId),
    removeDocument: (conversationId: string, documentId: string) =>
      ipcRenderer.invoke('rag:removeDocument', conversationId, documentId)
  },
  embeddings: {
    generate: (modelId: string, texts: string[]) =>
      ipcRenderer.invoke('embed:generate', modelId, texts)
  },
  audio: {
    transcribe: (request: TranscribeSendRequest) => ipcRenderer.invoke('audio:transcribe', request),
    transcribeFromBuffer: (request: TranscribeFromBufferRequest) =>
      ipcRenderer.invoke('audio:transcribeFromBuffer', request),
    stop: (requestId: string) => ipcRenderer.invoke('audio:stop', requestId),
    onChunk: (callback: (event: TranscribeChunkEvent) => void) => {
      const listener = (_e: unknown, data: TranscribeChunkEvent): void => callback(data)
      ipcRenderer.on('audio:chunk', listener)
      return () => ipcRenderer.removeListener('audio:chunk', listener)
    }
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
