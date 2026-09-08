import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let tempDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => tempDir
  }
}))

describe('db', () => {
  let db: typeof import('../db')

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'fle-db-test-'))
    vi.resetModules()
    db = await import('../db')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates a conversation and lists it back', () => {
    const conv = db.createConversation('model-a', 'My chat')
    expect(conv.title).toBe('My chat')
    expect(conv.modelId).toBe('model-a')

    const list = db.listConversations()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(conv.id)
  })

  it('orders conversations by most recently updated first', () => {
    const first = db.createConversation('model-a', 'First')
    const second = db.createConversation('model-a', 'Second')
    db.appendMessage(first.id, 'user', 'hello again')

    const list = db.listConversations()
    expect(list[0].id).toBe(first.id)
    expect(list[1].id).toBe(second.id)
  })

  it('appends and retrieves messages in order', () => {
    const conv = db.createConversation('model-a', 'Chat')
    db.appendMessage(conv.id, 'user', 'hi')
    db.appendMessage(conv.id, 'assistant', 'hello!')

    const messages = db.getMessages(conv.id)
    expect(messages.map((m) => m.content)).toEqual(['hi', 'hello!'])
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('renames a conversation', () => {
    const conv = db.createConversation('model-a', 'Old title')
    db.renameConversation(conv.id, 'New title')
    const list = db.listConversations()
    expect(list[0].title).toBe('New title')
  })

  it('deletes a conversation and its messages', () => {
    const conv = db.createConversation('model-a', 'Doomed')
    db.appendMessage(conv.id, 'user', 'will be deleted')

    db.deleteConversation(conv.id)

    expect(db.listConversations()).toHaveLength(0)
    expect(db.getMessages(conv.id)).toHaveLength(0)
  })

  it('only deletes messages belonging to the targeted conversation', () => {
    const keep = db.createConversation('model-a', 'Keep me')
    const remove = db.createConversation('model-a', 'Remove me')
    db.appendMessage(keep.id, 'user', 'keep this message')
    db.appendMessage(remove.id, 'user', 'remove this message')

    db.deleteConversation(remove.id)

    const remaining = db.listConversations()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(keep.id)
    expect(db.getMessages(keep.id)).toHaveLength(1)
  })
})
