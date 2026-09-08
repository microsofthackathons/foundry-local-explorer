import { app } from 'electron'
import { join, extname } from 'path'
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { randomUUID } from 'crypto'
import type { DocumentSummary, IngestResult, RagChunkResult } from '@shared/types'
import { embedTexts } from './foundry'
import { conversationExists } from './db'

const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx'])
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB
const CHUNK_SIZE_CHARS = 1200
const CHUNK_OVERLAP_CHARS = 200

interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

// pdf-parse (via its bundled pdfjs-dist worker) unconditionally constructs a
// browser `DOMMatrix` while compiling Type 3 font glyphs, regardless of
// whether it's running in a browser or Node.js. The Electron main process
// has no DOM, so ingesting any PDF that embeds a Type 3 font throws
// "ReferenceError: DOMMatrix is not defined" the first time such a glyph is
// compiled. This is a minimal polyfill covering only the 2D affine-transform
// subset (scaleSelf/translateSelf chaining) that pdf.js actually exercises.
class DOMMatrixPolyfill implements Matrix2D {
  a = 1
  b = 0
  c = 0
  d = 1
  e = 0
  f = 0

  constructor(init?: number[]) {
    if (Array.isArray(init) && init.length === 6) {
      const [a, b, c, d, e, f] = init
      this.a = a
      this.b = b
      this.c = c
      this.d = d
      this.e = e
      this.f = f
    }
  }

  multiplySelf(other: Matrix2D): this {
    const { a, b, c, d, e, f } = this
    this.a = a * other.a + c * other.b
    this.b = b * other.a + d * other.b
    this.c = a * other.c + c * other.d
    this.d = b * other.c + d * other.d
    this.e = a * other.e + c * other.f + e
    this.f = b * other.e + d * other.f + f
    return this
  }

  scaleSelf(scaleX = 1, scaleY = scaleX): this {
    return this.multiplySelf({ a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 })
  }

  translateSelf(tx = 0, ty = 0): this {
    return this.multiplySelf({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty })
  }
}

// Minimal stand-ins for the other two DOM globals that pdf.js's Node.js
// bootstrap (node_utils.mjs) tries to polyfill via the optional
// `@napi-rs/canvas` package. We don't ship that native dependency (it would
// require Electron native-module rebuilds/packaging per platform), and text
// extraction never exercises actual canvas rendering, so these only need to
// exist to satisfy `typeof globalThis.X === 'undefined'` checks and stop the
// "Cannot load @napi-rs/canvas" / "Cannot polyfill ImageData/Path2D" warnings.
class ImageDataPolyfill {
  data: Uint8ClampedArray
  width: number
  height: number

  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      this.data = dataOrWidth
      this.width = widthOrHeight
      this.height = height ?? 0
    } else {
      this.width = dataOrWidth
      this.height = widthOrHeight
      this.data = new Uint8ClampedArray(this.width * this.height * 4)
    }
  }
}

class Path2DPolyfill {
  // No-op: only needs to exist. Path drawing isn't exercised by text extraction.
}

function ensurePdfDomPolyfills(): void {
  const g = globalThis as unknown as Record<string, unknown>
  if (typeof g.DOMMatrix === 'undefined') {
    g.DOMMatrix = DOMMatrixPolyfill
  }
  if (typeof g.ImageData === 'undefined') {
    g.ImageData = ImageDataPolyfill
  }
  if (typeof g.Path2D === 'undefined') {
    g.Path2D = Path2DPolyfill
  }
}

// pdf.js's Node.js bootstrap always attempts `require("@napi-rs/canvas")` --
// regardless of whether DOMMatrix/ImageData/Path2D are already polyfilled --
// purely to see if it can use it for actual canvas rendering. We don't ship
// that native dependency, so this specific warning is unavoidable via
// globalThis polyfills alone. It only fires once, at first module evaluation
// (Node caches the module after that), so we suppress just that one known,
// benign message during the (first) dynamic import.
async function importPdfParse(): Promise<typeof import('pdf-parse')> {
  const originalWarn = console.warn
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && args[0].includes('@napi-rs/canvas')) return
    originalWarn(...args)
  }
  try {
    return await import('pdf-parse')
  } finally {
    console.warn = originalWarn
  }
}

interface StoredChunk {
  chunkIndex: number
  text: string
  embedding: number[]
}

interface DocRecord {
  documentId: string
  documentName: string
  chunks: StoredChunk[]
}

// conversationId -> documents attached to that conversation
const store = new Map<string, DocRecord[]>()
let loaded = false

function storePath(): string {
  return join(app.getPath('userData'), 'rag-store.json')
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const raw = await readFile(storePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, DocRecord[]>
    for (const [conversationId, docs] of Object.entries(parsed)) {
      store.set(conversationId, docs)
    }
  } catch {
    // No store yet, or unreadable — start fresh.
  }
}

async function persist(): Promise<void> {
  const obj: Record<string, DocRecord[]> = {}
  for (const [conversationId, docs] of store.entries()) obj[conversationId] = docs
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(storePath(), JSON.stringify(obj), 'utf-8')
}

async function extractText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported file type "${ext}". Supported: ${[...ALLOWED_EXTENSIONS].join(', ')}`)
  }

  const fileStat = await stat(filePath)
  if (fileStat.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large (${Math.round(fileStat.size / 1024 / 1024)} MB). Limit is 25 MB.`)
  }

  if (ext === '.txt' || ext === '.md') {
    return readFile(filePath, 'utf-8')
  }

  if (ext === '.pdf') {
    ensurePdfDomPolyfills()
    const { PDFParse } = await importPdfParse()
    const buffer = await readFile(filePath)
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      return result.text
    } finally {
      await parser.destroy()
    }
  }

  // .docx
  const mammoth = await import('mammoth')
  const buffer = await readFile(filePath)
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const chunks: string[] = []
  let start = 0
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, normalized.length)
    chunks.push(normalized.slice(start, end))
    if (end === normalized.length) break
    start = end - CHUNK_OVERLAP_CHARS
  }
  return chunks
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Extracts, chunks, embeds, and stores a dropped document for a given conversation. */
export async function ingestFile(
  conversationId: string,
  filePath: string,
  embedModelId: string
): Promise<IngestResult> {
  await ensureLoaded()
  const text = await extractText(filePath)
  const chunks = chunkText(text)
  if (chunks.length === 0) {
    throw new Error('No extractable text was found in this file.')
  }

  const embeddings = await embedTexts(embedModelId, chunks)

  // The embedding call above can take a long time (large file, slow model),
  // during which the user may have deleted this conversation. Discard the
  // (now-orphaned) result rather than writing it back into the store, which
  // would otherwise silently resurrect a conversation's document data after
  // deletion, defeating history:deleteConversation's cleanup.
  if (!conversationExists(conversationId)) {
    throw new Error('The conversation was deleted while this document was being processed.')
  }

  const documentId = randomUUID()
  const documentName = filePath.split(/[\\/]/).pop() ?? filePath

  const record: DocRecord = {
    documentId,
    documentName,
    chunks: chunks.map((chunkTextValue, i) => ({
      chunkIndex: i,
      text: chunkTextValue,
      embedding: embeddings[i]
    }))
  }

  const docs = store.get(conversationId) ?? []
  docs.push(record)
  store.set(conversationId, docs)
  await persist()

  return { documentId, documentName, chunkCount: chunks.length }
}

export async function listDocuments(conversationId: string): Promise<DocumentSummary[]> {
  await ensureLoaded()
  const docs = store.get(conversationId) ?? []
  return docs.map((d) => ({
    documentId: d.documentId,
    documentName: d.documentName,
    chunkCount: d.chunks.length
  }))
}

export async function removeDocument(conversationId: string, documentId: string): Promise<void> {
  await ensureLoaded()
  const docs = store.get(conversationId) ?? []
  store.set(conversationId, docs.filter((d) => d.documentId !== documentId))
  await persist()
}

/** Removes every ingested document for a conversation. Called when the conversation itself
 *  is deleted, so its RAG data doesn't linger forever as dead weight in rag-store.json. */
export async function removeAllDocumentsForConversation(conversationId: string): Promise<void> {
  await ensureLoaded()
  if (!store.has(conversationId)) return
  store.delete(conversationId)
  await persist()
}

/** One-time startup reconciliation: removes any RAG documents left behind for conversations
 *  that no longer exist in the conversation history database. This covers documents that were
 *  already orphaned before removeAllDocumentsForConversation existed, plus any that slipped
 *  through despite it (e.g. the app was killed between the SQL delete and the RAG persist). */
export async function pruneOrphanedDocuments(
  validConversationIds: ReadonlySet<string>
): Promise<void> {
  await ensureLoaded()
  let changed = false
  for (const conversationId of store.keys()) {
    if (!validConversationIds.has(conversationId)) {
      store.delete(conversationId)
      changed = true
    }
  }
  if (changed) await persist()
}

/** Embeds the query and returns the top-k most similar chunks across all documents in the conversation. */
export async function retrieve(
  conversationId: string,
  query: string,
  embedModelId: string,
  topK = 4
): Promise<RagChunkResult[]> {
  await ensureLoaded()
  const docs = store.get(conversationId) ?? []
  if (docs.length === 0) return []

  const allChunks = docs.flatMap((doc) =>
    doc.chunks.map((chunk) => ({
      documentName: doc.documentName,
      chunkIndex: chunk.chunkIndex,
      text: chunk.text,
      embedding: chunk.embedding
    }))
  )

  // Similarity search against a single chunk embedding works well for a specific
  // question ("what does section 3 say about X?"), but a broad request like
  // "summarize the document" isn't semantically close to any particular chunk,
  // so plain top-K retrieval can return an almost-arbitrary slice of the text -
  // or, for short documents, miss content the model actually needs. Detect that
  // case and just hand over every chunk (bounded by a generous cap) instead of
  // relying on similarity ranking.
  const wantsWholeDocument = /\b(summar|overview|tl;?dr|main points|key points|gist)\b/i.test(
    query
  )
  const WHOLE_DOC_CHUNK_CAP = 12
  if (wantsWholeDocument || allChunks.length <= topK) {
    return allChunks.slice(0, WHOLE_DOC_CHUNK_CAP).map((c) => ({
      documentName: c.documentName,
      chunkIndex: c.chunkIndex,
      text: c.text,
      score: 1
    }))
  }

  const [queryEmbedding] = await embedTexts(embedModelId, [query])

  const scored: RagChunkResult[] = allChunks.map((c) => ({
    documentName: c.documentName,
    chunkIndex: c.chunkIndex,
    text: c.text,
    score: cosineSimilarity(queryEmbedding, c.embedding)
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
