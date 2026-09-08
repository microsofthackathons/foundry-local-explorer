import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let tempDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => tempDir
  }
}))

// A fake, deterministic embedding: turns text into a 2D vector so we can
// reason about cosine similarity precisely without a real model.
function fakeEmbed(text: string): number[] {
  const aCount = (text.match(/a/gi) ?? []).length
  const bCount = (text.match(/b/gi) ?? []).length
  return [aCount, bCount]
}

vi.mock('../foundry', () => ({
  embedTexts: vi.fn(async (_modelId: string, texts: string[]) => texts.map(fakeEmbed))
}))

describe('rag', () => {
  let rag: typeof import('../rag')

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'fle-rag-test-'))
    vi.resetModules()
    rag = await import('../rag')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('ingests a text file, chunking and embedding its contents', async () => {
    const filePath = join(tempDir, 'note.txt')
    writeFileSync(filePath, 'aaa bbb ccc')

    const result = await rag.ingestFile('conv-1', filePath, 'embed-model')

    expect(result.documentName).toBe('note.txt')
    expect(result.chunkCount).toBe(1)

    const docs = await rag.listDocuments('conv-1')
    expect(docs).toHaveLength(1)
    expect(docs[0].documentId).toBe(result.documentId)
  })

  it('rejects unsupported file extensions', async () => {
    const filePath = join(tempDir, 'note.exe')
    writeFileSync(filePath, 'binary junk')

    await expect(rag.ingestFile('conv-1', filePath, 'embed-model')).rejects.toThrow(
      /Unsupported file type/
    )
  })

  it('removes a document by id', async () => {
    const filePath = join(tempDir, 'note.txt')
    writeFileSync(filePath, 'some content')
    const { documentId } = await rag.ingestFile('conv-1', filePath, 'embed-model')

    await rag.removeDocument('conv-1', documentId)

    expect(await rag.listDocuments('conv-1')).toHaveLength(0)
  })

  it('persists documents across module reloads (survives "restart")', async () => {
    const filePath = join(tempDir, 'note.txt')
    writeFileSync(filePath, 'persisted content')
    await rag.ingestFile('conv-1', filePath, 'embed-model')

    vi.resetModules()
    const reloaded: typeof import('../rag') = await import('../rag')

    const docs = await reloaded.listDocuments('conv-1')
    expect(docs).toHaveLength(1)
  })

  it('retrieve() ranks chunks by cosine similarity to the query', async () => {
    const filePath = join(tempDir, 'note.txt')
    // Two short "documents" worth of content in one file, split by size so
    // they land in separate chunks isn't guaranteed — instead ingest two
    // files so we get two distinctly-embeddable chunks.
    writeFileSync(filePath, 'aaaaaaaaaa')
    await rag.ingestFile('conv-1', filePath, 'embed-model')

    const filePath2 = join(tempDir, 'note2.txt')
    writeFileSync(filePath2, 'bbbbbbbbbb')
    await rag.ingestFile('conv-1', filePath2, 'embed-model')

    // A query embedding close to the "a"-heavy vector should rank the first
    // chunk above the "b"-heavy one — but retrieve() only does a real
    // similarity search when there are more chunks than topK, so ask for
    // top 1 out of 2.
    const results = await rag.retrieve('conv-1', 'aaaaaaaaaa query', 'embed-model', 1)

    expect(results).toHaveLength(1)
    expect(results[0].text).toBe('aaaaaaaaaa')
  })

  it('retrieve() returns every chunk (bounded) for whole-document summary queries', async () => {
    const filePath = join(tempDir, 'note.txt')
    writeFileSync(filePath, 'aaaaaaaaaa')
    await rag.ingestFile('conv-1', filePath, 'embed-model')
    const filePath2 = join(tempDir, 'note2.txt')
    writeFileSync(filePath2, 'bbbbbbbbbb')
    await rag.ingestFile('conv-1', filePath2, 'embed-model')

    const results = await rag.retrieve('conv-1', 'what is the gist of this', 'embed-model', 1)

    expect(results).toHaveLength(2)
  })

  it('retrieve() returns an empty array when the conversation has no documents', async () => {
    expect(await rag.retrieve('unknown-conv', 'anything', 'embed-model')).toEqual([])
  })
})
