import { Hono } from 'hono';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { ItemDetail, ItemListResult, ItemType } from '@app/shared';
import type { AppDb } from '../db.js';

interface RouteDeps {
  db: AppDb;
}

const ITEM_TYPES = new Set<ItemType>(['tweet', 'article', 'website', 'github']);

export function createItemRoutes({ db }: RouteDeps): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const typeParam = c.req.query('type') as ItemType | undefined;
    const type = typeParam && ITEM_TYPES.has(typeParam) ? typeParam : undefined;
    const q = c.req.query('q') || undefined;
    const tag = c.req.query('tag') || undefined;
    const limit = Number(c.req.query('limit')) || undefined;
    const offset = Number(c.req.query('offset')) || undefined;
    const result = db.listItems({ type, q, tag, limit, offset });
    return c.json(result satisfies ItemListResult);
  });

  app.get('/tags', (c) => {
    return c.json(db.listTags());
  });

  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const item = db.getItem(id);
    if (!item) return c.json({ error: '条目不存在' }, 404);
    const contentPath = db.itemContentPath(id);
    let content: string | null = null;
    if (existsSync(contentPath)) {
      try {
        content = readFileSync(contentPath, 'utf8');
      } catch {
        content = null;
      }
    }
    const detail: ItemDetail = { ...item, content };
    return c.json(detail);
  });

  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    if (!db.getItem(id)) return c.json({ error: '条目不存在' }, 404);
    const body = await c.req
      .json<{ title?: string; notes?: string; tags?: string[] }>()
      .catch(() => null);
    if (!body) return c.json({ error: '请求体格式错误' }, 400);

    const patch: { title?: string; notes?: string; tags?: string[] } = {};
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 300);
    if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 20_000);
    if (Array.isArray(body.tags)) {
      patch.tags = body.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().slice(0, 50))
        .filter(Boolean)
        .slice(0, 20);
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: '没有可更新的字段' }, 400);
    }
    const updated = db.updateItem(id, patch);
    return c.json(updated);
  });

  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    const deleted = db.deleteItem(id);
    if (!deleted) return c.json({ error: '条目不存在' }, 404);
    try {
      rmSync(path.dirname(db.itemContentPath(id)), { recursive: true, force: true });
    } catch {
      /* 缓存文件清理失败不阻塞 */
    }
    return c.json({ ok: true });
  });

  return app;
}
