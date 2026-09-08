import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { ChatRole, ConversationSummary, StoredMessage } from '@shared/types'

let db: Database.Database | null = null

function getDb(): Database.Database {
  if (db) return db
  const dbPath = join(app.getPath('userData'), 'history.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  // SQLite disables foreign key enforcement per-connection by default, so the
  // ON DELETE CASCADE below is otherwise decorative and never actually runs.
  // Must be set on every new connection (it is not a persistent database
  // setting).
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  `)
  return db
}

export function createConversation(modelId: string, title: string): ConversationSummary {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      'INSERT INTO conversations (id, title, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(id, title, modelId, now, now)
  return { id, title, modelId, createdAt: now, updatedAt: now }
}

export function listConversations(): ConversationSummary[] {
  const rows = getDb()
    .prepare('SELECT id, title, model_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC')
    .all() as Array<{ id: string; title: string; model_id: string; created_at: number; updated_at: number }>
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    modelId: r.model_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }))
}

export function getMessages(conversationId: string): StoredMessage[] {
  const rows = getDb()
    .prepare(
      'SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC'
    )
    .all(conversationId) as Array<{
    id: number
    conversation_id: string
    role: string
    content: string
    created_at: number
  }>
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as ChatRole,
    content: r.content,
    createdAt: r.created_at
  }))
}

export function appendMessage(conversationId: string, role: ChatRole, content: string): void {
  const now = Date.now()
  const database = getDb()
  database
    .prepare(
      'INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(conversationId, role, content, now)
  database.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
}

export function renameConversation(conversationId: string, title: string): void {
  getDb().prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId)
}

export function deleteConversation(conversationId: string): void {
  // With `PRAGMA foreign_keys = ON` (set in getDb()), this cascades to delete
  // the conversation's messages too, per the ON DELETE CASCADE constraint on
  // messages.conversation_id — no need to delete messages manually.
  getDb().prepare('DELETE FROM conversations WHERE id = ?').run(conversationId)
}

/** True if a conversation with this id still exists. Used by rag.ts to detect
 *  (and discard) a document ingestion that raced with the conversation being
 *  deleted mid-flight. */
export function conversationExists(conversationId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM conversations WHERE id = ?').get(conversationId)
  return row !== undefined
}
