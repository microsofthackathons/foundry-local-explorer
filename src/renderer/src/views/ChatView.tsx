import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChatMessage,
  ConversationSummary,
  DocumentSummary,
  ModelSummary,
  StoredMessage
} from '@shared/types'
import { filterChatModels, filterEmbeddingModels } from '../modelCategories'

function ChatView(): React.JSX.Element {
  const [loadedModels, setLoadedModels] = useState<ModelSummary[]>([])
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [documents, setDocuments] = useState<DocumentSummary[]>([])

  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [embedModelId, setEmbedModelId] = useState<string>('')
  const [input, setInput] = useState('')
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const refreshLoadedModels = useCallback(async () => {
    const all = await window.api.foundry.listModels()
    const loaded = all.filter((m) => m.loaded)
    setLoadedModels(loaded)
    // Pick sensible defaults instead of always defaulting both dropdowns to
    // loaded[0]: an embeddings model can't do chat, and a chat model can't
    // generate usable embeddings, so defaulting both to the same model
    // silently breaks RAG (ingestion/retrieval fail or return garbage, and
    // the document context never reaches the chat model).
    if (!selectedModelId) {
      const chatCandidate = filterChatModels(loaded)[0]
      if (chatCandidate) setSelectedModelId(chatCandidate.id)
    }
    if (!embedModelId) {
      const embedCandidate = filterEmbeddingModels(loaded)[0]
      if (embedCandidate) setEmbedModelId(embedCandidate.id)
    }
  }, [selectedModelId, embedModelId])

  const chatModelOptions = useMemo(() => filterChatModels(loadedModels), [loadedModels])
  const embedModelOptions = useMemo(() => filterEmbeddingModels(loadedModels), [loadedModels])

  const refreshConversations = useCallback(async () => {
    const list = await window.api.history.listConversations()
    setConversations(list)
  }, [])

  useEffect(() => {
    async function run(): Promise<void> {
      await refreshLoadedModels()
      await refreshConversations()
    }
    run().catch(() => {})
  }, [refreshLoadedModels, refreshConversations])

  useEffect(() => {
    const unsubscribe = window.api.chat.onChunk(({ requestId, delta, done, error: err }) => {
      if (requestId !== requestIdRef.current) return
      if (delta) setStreamingText((prev) => prev + delta)
      if (done) {
        setIsStreaming(false)
        if (err) setError(err)
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streamingText])

  useEffect(() => {
    if (!activeConversationId) {
      // Resetting derived view state when the conversation selection clears;
      // this is local UI-state cleanup, not a remote fetch that needs
      // restructuring.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([])
      setDocuments([])
      return
    }
    window.api.history.getMessages(activeConversationId).then(setMessages)
    window.api.rag.listDocuments(activeConversationId).then(setDocuments)
  }, [activeConversationId])

  async function ensureConversation(firstMessage: string): Promise<string> {
    if (activeConversationId) return activeConversationId
    const title = firstMessage.slice(0, 40) || 'New conversation'
    const conv = await window.api.history.createConversation(selectedModelId, title)
    setConversations((prev) => [conv, ...prev])
    setActiveConversationId(conv.id)
    return conv.id
  }

  async function handleSend(): Promise<void> {
    if (!input.trim() || !selectedModelId || isStreaming) return

    if (documents.length > 0 && !embedModelId) {
      setError('Select an embedding model before asking questions about uploaded documents.')
      return
    }

    setError(null)
    const text = input.trim()
    setInput('')

    const conversationId = await ensureConversation(text || 'Chat')
    const priorMessages: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }))
    const nextMessages: ChatMessage[] = [...priorMessages, { role: 'user', content: text }]

    const echoId = Date.now()
    setMessages((prev) => [
      ...prev,
      { id: echoId, conversationId, role: 'user', content: text, createdAt: Date.now() }
    ])

    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    setStreamingText('')
    setIsStreaming(true)

    try {
      const result = await window.api.chat.send({
        requestId,
        conversationId,
        modelId: selectedModelId,
        messages: nextMessages,
        embedModelId: documents.length > 0 ? embedModelId : undefined
      })
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          conversationId,
          role: 'assistant',
          content: result.content,
          createdAt: Date.now()
        }
      ])
      if (result.ragWarning) {
        setError(`Document context could not be retrieved: ${result.ragWarning}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStreaming(false)
      setStreamingText('')
    }
  }

  function handleStop(): void {
    if (requestIdRef.current) window.api.chat.stop(requestIdRef.current)
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setIsDragOver(false)
    if (!embedModelId) {
      setError('Pick an embedding model (a loaded model) before dropping documents.')
      return
    }
    const conversationId = await ensureConversation('Document chat')
    for (const file of Array.from(e.dataTransfer.files)) {
      const path = window.api.getPathForFile(file)
      try {
        await window.api.rag.ingestFile(conversationId, path, embedModelId)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    const docs = await window.api.rag.listDocuments(conversationId)
    setDocuments(docs)
  }

  async function handleRemoveDocument(documentId: string): Promise<void> {
    if (!activeConversationId) return
    await window.api.rag.removeDocument(activeConversationId, documentId)
    setDocuments(await window.api.rag.listDocuments(activeConversationId))
  }

  async function handleNewConversation(): Promise<void> {
    setActiveConversationId(null)
  }

  async function handleDeleteConversation(id: string): Promise<void> {
    await window.api.history.deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeConversationId === id) setActiveConversationId(null)
  }

  return (
    <div className="view chat-view">
      <div className="chat-conversations">
        <button className="new-chat-btn" onClick={handleNewConversation}>
          + New chat
        </button>
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`conversation-item ${activeConversationId === c.id ? 'active' : ''}`}
            onClick={() => setActiveConversationId(c.id)}
          >
            <span className="conversation-title">{c.title}</span>
            <button
              className="conversation-delete"
              onClick={(e) => {
                e.stopPropagation()
                handleDeleteConversation(c.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="chat-main">
        <div className="chat-header">
          <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
            {chatModelOptions.length === 0 && <option value="">No chat models loaded</option>}
            {chatModelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
          <select value={embedModelId} onChange={(e) => setEmbedModelId(e.target.value)}>
            <option value="">
              {embedModelOptions.length === 0
                ? 'No embedding models loaded'
                : 'Embedding model (for documents)'}
            </option>
            {embedModelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div
          className={`chat-dropzone ${isDragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragOver(true)
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <span className="muted">
            📄 Drop a .txt, .md, .pdf, or .docx file here to chat about its contents. Pictures
            aren’t supported — the local model can’t see images.
          </span>
        </div>

        {documents.length > 0 && (
          <div className="document-chips">
            {documents.map((d) => (
              <span key={d.documentId} className="document-chip">
                📄 {d.documentName} ({d.chunkCount})
                <button onClick={() => handleRemoveDocument(d.documentId)}>✕</button>
              </span>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="chat-messages">
          {messages.length === 0 && !isStreaming && (
            <p className="muted chat-empty">
              Load a model in the Catalog tab, then start chatting.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`chat-bubble ${m.role}`}>
              <div className="chat-role">{m.role}</div>
              <div className="chat-content">{m.content}</div>
            </div>
          ))}
          {isStreaming && (
            <div className="chat-bubble assistant">
              <div className="chat-role">assistant</div>
              <div className="chat-content">{streamingText || '…'}</div>
            </div>
          )}
        </div>

        <div className="chat-input-row">
          <textarea
            value={input}
            placeholder={
              loadedModels.length === 0
                ? 'Load a model first in the Catalog tab…'
                : 'Message the model…'
            }
            disabled={loadedModels.length === 0}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          {isStreaming ? (
            <button className="stop-btn" onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim() || !selectedModelId}>
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ChatView
