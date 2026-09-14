import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConversationSummary, Item, ItemType } from '@cairn/shared';

export interface AgentMessageRow {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  created_at: number;
}

export interface ItemInput {
  type: ItemType;
  url: string;
  title: string;
  summary: string;
  report?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  conversationId?: string | null;
  /** 用于 FTS 全文索引的正文（来自抓取缓存） */
  contentText?: string | null;
}

interface ItemRow {
  id: string;
  type: ItemType;
  url: string;
  title: string;
  summary: string;
  report: string | null;
  notes: string;
  tags: string;
  metadata: string;
  conversation_id: string | null;
  created_at: number;
  updated_at: number;
}

interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '新对话',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('tweet','article','website','github')),
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  report TEXT,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  conversation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  item_id UNINDEXED, title, summary, report, notes, content_text,
  tokenize='trigram'
);
`;

export interface AppDb {
  itemsDir: string;
  itemContentPath(id: string): string;
  createConversation(): ConversationSummary;
  listConversations(): ConversationSummary[];
  getConversation(id: string): ConversationSummary | null;
  renameConversation(id: string, title: string): ConversationSummary | null;
  touchConversation(id: string): void;
  deleteConversation(id: string): void;
  getAgentMessages(conversationId: string): AgentMessageRow[];
  appendMessage(conversationId: string, role: string, message: unknown): number;
  conversationHasMessages(conversationId: string): boolean;
  upsertItem(input: ItemInput): { item: Item; created: boolean };
  getItem(id: string): Item | null;
  /** 按 URL 查条目 id（导入去重用），不存在返回 null */
  findItemByUrl(url: string): string | null;
  listItems(opts?: {
    type?: ItemType;
    q?: string;
    tag?: string;
    limit?: number;
    offset?: number;
  }): { items: Item[]; total: number };
  updateItem(
    id: string,
    patch: { title?: string; notes?: string; tags?: string[] },
  ): Item | null;
  deleteItem(id: string): boolean;
  /** 全部标签及计数（标签筛选器用） */
  listTags(): { tag: string; count: number }[];
  close(): void;
}

function toConversation(row: ConversationRow): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toItem(row: ItemRow): Item {
  let tags: string[] = [];
  let metadata: Record<string, unknown> = {};
  try {
    tags = JSON.parse(row.tags);
  } catch {
    /* 保底为空 */
  }
  try {
    metadata = JSON.parse(row.metadata);
  } catch {
    /* 保底为空 */
  }
  return {
    id: row.id,
    type: row.type,
    url: row.url,
    title: row.title,
    summary: row.summary,
    report: row.report,
    notes: row.notes,
    tags,
    metadata,
    conversationId: row.conversation_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function createDb(dataDir: string): AppDb {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const itemsDir = path.join(dataDir, 'items');

  const stmt = {
    createConv: db.prepare(
      `INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, '新对话', ?, ?)`,
    ),
    listConvs: db.prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`),
    getConv: db.prepare(`SELECT * FROM conversations WHERE id = ?`),
    renameConv: db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`),
    touchConv: db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`),
    deleteConvMsgs: db.prepare(`DELETE FROM messages WHERE conversation_id = ?`),
    deleteConv: db.prepare(`DELETE FROM conversations WHERE id = ?`),
    listMsgs: db.prepare(
      `SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC`,
    ),
    appendMsg: db.prepare(
      `INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)`,
    ),
    hasMsgs: db.prepare(`SELECT 1 FROM messages WHERE conversation_id = ? LIMIT 1`),
    findItemByUrl: db.prepare(`SELECT id FROM items WHERE url = ?`),
    insertItem: db.prepare(
      `INSERT INTO items (id, type, url, title, summary, report, notes, tags, metadata, conversation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
    ),
    updateItemRow: db.prepare(
      `UPDATE items SET type = ?, title = ?, summary = ?, report = ?, tags = ?, metadata = ?, updated_at = ? WHERE id = ?`,
    ),
    getItemRow: db.prepare(`SELECT * FROM items WHERE id = ?`),
    countItems: db.prepare(`SELECT COUNT(*) AS n FROM items`),
    deleteItemRow: db.prepare(`DELETE FROM items WHERE id = ?`),
    deleteFts: db.prepare(`DELETE FROM items_fts WHERE item_id = ?`),
    insertFts: db.prepare(
      `INSERT INTO items_fts (item_id, title, summary, report, notes, content_text) VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    ftsMatch: db.prepare(`SELECT item_id FROM items_fts WHERE items_fts MATCH ?`),
    ftsLike: db.prepare(
      `SELECT item_id FROM items_fts
       WHERE title LIKE ? ESCAPE '\\'
          OR summary LIKE ? ESCAPE '\\'
          OR report LIKE ? ESCAPE '\\'
          OR notes LIKE ? ESCAPE '\\'
          OR content_text LIKE ? ESCAPE '\\'`,
    ),
    getFtsRow: db.prepare(`SELECT content_text FROM items_fts WHERE item_id = ?`),
  };

  function ftsSearch(q: string): string[] {
    // trigram 索引支持 ≥3 字符的子串匹配（含中文）；
    // 更短的查询（如两字中文词）与 MATCH 语法异常时回退 LIKE 子串匹配
    if ([...q].length >= 3) {
      const phrase = `"${q.replace(/"/g, '""')}"`;
      try {
        const rows = stmt.ftsMatch.all(phrase) as { item_id: string }[];
        if (rows.length > 0) return rows.map((r) => r.item_id);
      } catch {
        /* 语法问题走 LIKE 回退 */
      }
    }
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    try {
      const rows = stmt.ftsLike.all(like, like, like, like, like) as { item_id: string }[];
      return rows.map((r) => r.item_id);
    } catch {
      return [];
    }
  }

  /**
   * 重建一条 FTS 行。调用发生在 items 表写入之后，title/summary/report/notes
   * 一律取 items 表最新值（notes 在此前的 bug 里从不写入，导致用户笔记不可检索）；
   * contentText 仅在缓存命中时替换，否则沿用原 FTS 行 —— 缓存正文没有对应的
   * items 列，编辑笔记 / 无缓存重复收录都不应清空它。
   */
  function syncFts(id: string, contentText?: string | null) {
    const row = stmt.getItemRow.get(id) as ItemRow | undefined;
    if (!row) return;
    const ftsRow = stmt.getFtsRow.get(id) as { content_text?: string } | undefined;
    stmt.deleteFts.run(id);
    stmt.insertFts.run(
      id,
      row.title,
      row.summary,
      row.report,
      row.notes,
      contentText ?? ftsRow?.content_text ?? '',
    );
  }

  return {
    itemsDir,
    itemContentPath(id) {
      return path.join(itemsDir, id, 'content.md');
    },

    createConversation() {
      const id = randomUUID();
      const now = Date.now();
      stmt.createConv.run(id, now, now);
      const row = stmt.getConv.get(id) as ConversationRow;
      return toConversation(row);
    },

    listConversations() {
      return (stmt.listConvs.all() as ConversationRow[]).map(toConversation);
    },

    getConversation(id) {
      const row = stmt.getConv.get(id) as ConversationRow | undefined;
      return row ? toConversation(row) : null;
    },

    renameConversation(id, title) {
      const info = stmt.renameConv.run(title, Date.now(), id);
      if (info.changes === 0) return null;
      const row = stmt.getConv.get(id) as ConversationRow;
      return toConversation(row);
    },

    touchConversation(id) {
      stmt.touchConv.run(Date.now(), id);
    },

    deleteConversation(id) {
      stmt.deleteConvMsgs.run(id);
      stmt.deleteConv.run(id);
    },

    getAgentMessages(conversationId) {
      return stmt.listMsgs.all(conversationId) as AgentMessageRow[];
    },

    appendMessage(conversationId, role, message) {
      const info = stmt.appendMsg.run(conversationId, role, JSON.stringify(message), Date.now());
      return Number(info.lastInsertRowid);
    },

    conversationHasMessages(conversationId) {
      return stmt.hasMsgs.get(conversationId) !== undefined;
    },

    upsertItem(input) {
      const now = Date.now();
      const existing = stmt.findItemByUrl.get(input.url) as { id: string } | undefined;
      let id: string;
      let created: boolean;
      if (existing) {
        id = existing.id;
        created = false;
        stmt.updateItemRow.run(
          input.type,
          input.title,
          input.summary,
          input.report ?? null,
          JSON.stringify(input.tags ?? []),
          JSON.stringify(input.metadata ?? {}),
          now,
          id,
        );
      } else {
        id = randomUUID();
        created = true;
        stmt.insertItem.run(
          id,
          input.type,
          input.url,
          input.title,
          input.summary,
          input.report ?? null,
          JSON.stringify(input.tags ?? []),
          JSON.stringify(input.metadata ?? {}),
          input.conversationId ?? null,
          now,
          now,
        );
      }
      syncFts(id, input.contentText);
      const row = stmt.getItemRow.get(id) as ItemRow;
      return { item: toItem(row), created };
    },

    getItem(id) {
      const row = stmt.getItemRow.get(id) as ItemRow | undefined;
      return row ? toItem(row) : null;
    },

    findItemByUrl(url) {
      const row = stmt.findItemByUrl.get(url) as { id: string } | undefined;
      return row?.id ?? null;
    },

    listItems(opts = {}) {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
      const offset = Math.max(opts.offset ?? 0, 0);
      const where: string[] = [];
      const params: unknown[] = [];

      if (opts.type) {
        where.push('type = ?');
        params.push(opts.type);
      }
      if (opts.tag) {
        where.push(`EXISTS (SELECT 1 FROM json_each(items.tags) je WHERE je.value = ?)`);
        params.push(opts.tag);
      }
      if (opts.q && opts.q.trim()) {
        const ids = ftsSearch(opts.q.trim());
        if (ids.length === 0) return { items: [], total: 0 };
        where.push(`id IN (${ids.map(() => '?').join(',')})`);
        params.push(...ids);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (
        db.prepare(`SELECT COUNT(*) AS n FROM items ${whereSql}`).get(...params) as { n: number }
      ).n;
      const rows = db
        .prepare(`SELECT * FROM items ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset) as ItemRow[];
      return { items: rows.map(toItem), total };
    },

    updateItem(id, patch) {
      const row = stmt.getItemRow.get(id) as ItemRow | undefined;
      if (!row) return null;
      const title = patch.title ?? row.title;
      const notes = patch.notes ?? row.notes;
      let tags = patch.tags;
      if (!tags) {
        try {
          tags = JSON.parse(row.tags);
        } catch {
          tags = [];
        }
      }
      db.prepare(
        `UPDATE items SET title = ?, notes = ?, tags = ?, updated_at = ? WHERE id = ?`,
      ).run(title, notes, JSON.stringify(tags), Date.now(), id);
      syncFts(id);
      const updated = stmt.getItemRow.get(id) as ItemRow;
      return toItem(updated);
    },

    deleteItem(id) {
      const info = stmt.deleteItemRow.run(id);
      stmt.deleteFts.run(id);
      return info.changes > 0;
    },

    listTags() {
      const rows = db
        .prepare(
          `SELECT je.value AS tag, COUNT(*) AS n FROM items, json_each(items.tags) je
           WHERE je.value IS NOT NULL AND je.value != '' GROUP BY je.value ORDER BY n DESC`,
        )
        .all() as { tag: string; n: number }[];
      return rows.map((r) => ({ tag: r.tag, count: r.n }));
    },

    close() {
      db.close();
    },
  };
}
