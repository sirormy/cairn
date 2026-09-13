import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, type AppDb } from './db.js';

let db: AppDb;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'inbox-db-'));
  db = createDb(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('conversations', () => {
  it('创建 / 列表 / 重命名 / 删除', () => {
    const conv = db.createConversation();
    expect(conv.title).toBe('新对话');
    expect(db.listConversations()).toHaveLength(1);

    const renamed = db.renameConversation(conv.id, '测试');
    expect(renamed?.title).toBe('测试');

    expect(db.deleteConversation(conv.id)).toBeUndefined();
    expect(db.listConversations()).toHaveLength(0);
  });
});

describe('items upsert / 查询 / FTS', () => {
  it('同 URL 重复收录覆盖并保留笔记', () => {
    db.upsertItem({
      type: 'github',
      url: 'https://github.com/a/b',
      title: 'First',
      summary: '第一版摘要',
      tags: ['go'],
      contentText: 'golang 高性能网络库',
    });
    // 用户写下笔记
    db.updateItem(db.listItems().items[0].id, { notes: '我的笔记' });

    const { item } = db.upsertItem({
      type: 'github',
      url: 'https://github.com/a/b',
      title: 'Second',
      summary: '第二版摘要',
      tags: ['go', 'network'],
      contentText: 'golang 高性能网络库 v2',
    });
    expect(item.title).toBe('Second');
    expect(item.tags).toEqual(['go', 'network']);
    expect(item.notes).toBe('我的笔记'); // 笔记在覆盖时保留
    expect(db.listItems().total).toBe(1); // 未产生重复行
  });

  it('按类型与标签过滤', () => {
    db.upsertItem({ type: 'tweet', url: 'https://x.com/a/1', title: 't', summary: '', tags: ['ai'] });
    db.upsertItem({ type: 'article', url: 'https://a.com/1', title: 'a', summary: '', tags: ['ai'] });
    db.upsertItem({ type: 'github', url: 'https://github.com/a/b', title: 'g', summary: '', tags: ['rust'] });

    expect(db.listItems({ type: 'tweet' }).total).toBe(1);
    expect(db.listItems({ tag: 'ai' }).total).toBe(2);
    expect(db.listItems({ type: 'github', tag: 'ai' }).total).toBe(0);
  });

  it('FTS 全文检索（标题 / 摘要 / 正文）', () => {
    db.upsertItem({
      type: 'article',
      url: 'https://a.com/1',
      title: 'Understanding SQLite FTS5',
      summary: '全文索引入门',
      contentText: 'inverted index tokenization',
    });
    db.upsertItem({
      type: 'github',
      url: 'https://github.com/a/b',
      title: 'another repo',
      summary: '别的摘要',
      contentText: 'rust web framework',
    });

    expect(db.listItems({ q: 'SQLite' }).total).toBe(1);
    expect(db.listItems({ q: '全文' }).total).toBe(1);
    expect(db.listItems({ q: 'inverted' }).total).toBe(1);
    expect(db.listItems({ q: 'rust' }).total).toBe(1);
    // 用户输入不破坏 FTS 语法（引号被转义）
    expect(db.listItems({ q: '"weird" AND (query)' }).total).toBe(0);
  });

  it('FTS 笔记检索：笔记编辑后写入索引', () => {
    const { item } = db.upsertItem({
      type: 'article',
      url: 'https://a.com/1',
      title: '标题',
      summary: '摘要',
    });
    expect(db.listItems({ q: '用户私藏备注' }).total).toBe(0);
    db.updateItem(item.id, { notes: '用户私藏备注：值得再读一遍' });
    expect(db.listItems({ q: '私藏备注' }).total).toBe(1);
  });

  it('FTS 正文保留：编辑笔记不清空缓存正文索引', () => {
    const { item } = db.upsertItem({
      type: 'article',
      url: 'https://a.com/1',
      title: '标题',
      summary: '摘要',
      contentText: 'cached body text xyzzy',
    });
    db.updateItem(item.id, { notes: '一条笔记' });
    expect(db.listItems({ q: 'xyzzy' }).total).toBe(1);
    expect(db.listItems({ q: 'cached body' }).total).toBe(1);
  });

  it('FTS 正文保留：重复收录无缓存时不清空旧正文索引', () => {
    db.upsertItem({
      type: 'article',
      url: 'https://a.com/1',
      title: '第一版',
      summary: '',
      contentText: 'original body text',
    });
    const { item } = db.upsertItem({
      type: 'article',
      url: 'https://a.com/1',
      title: '第二版',
      summary: '',
    });
    expect(item.title).toBe('第二版');
    expect(db.listItems({ q: 'original body' }).total).toBe(1);
    // 提供新缓存时正常替换
    db.upsertItem({
      type: 'article',
      url: 'https://a.com/1',
      title: '第三版',
      summary: '',
      contentText: 'replaced body text',
    });
    expect(db.listItems({ q: 'original body' }).total).toBe(0);
    expect(db.listItems({ q: 'replaced body' }).total).toBe(1);
  });

  it('标签列表聚合', () => {
    db.upsertItem({ type: 'article', url: 'https://a.com/1', title: 'a', summary: '', tags: ['ai', 'go'] });
    db.upsertItem({ type: 'article', url: 'https://a.com/2', title: 'b', summary: '', tags: ['ai'] });
    const tags = db.listTags();
    expect(tags.find((t) => t.tag === 'ai')?.count).toBe(2);
    expect(tags.find((t) => t.tag === 'go')?.count).toBe(1);
  });

  it('删除条目后 FTS 同步清除', () => {
    const { item } = db.upsertItem({
      type: 'article',
      url: 'https://a.com/1',
      title: 'uniqueword',
      summary: '',
      contentText: '',
    });
    expect(db.listItems({ q: 'uniqueword' }).total).toBe(1);
    db.deleteItem(item.id);
    expect(db.listItems({ q: 'uniqueword' }).total).toBe(0);
  });
});

describe('messages', () => {
  it('追加与读取保持顺序', () => {
    const conv = db.createConversation();
    db.appendMessage(conv.id, 'user', { role: 'user', content: 'hi', timestamp: 1 });
    db.appendMessage(conv.id, 'assistant', { role: 'assistant', content: [], timestamp: 2 });
    const rows = db.getAgentMessages(conv.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].role).toBe('user');
    expect(JSON.parse(rows[0].content).content).toBe('hi');
    expect(db.conversationHasMessages(conv.id)).toBe(true);
  });
});
