import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BookmarkCheck, Inbox, Loader2, Search, X } from 'lucide-react';
import type { Item, ItemType } from '@cairn/shared';
import { TypeBadge, TYPE_META } from '../components/TypeBadge';
import { api } from '../lib/api';
import { hostOf, relativeTime } from '../lib/format';

const PAGE_SIZE = 30;

type Tab = 'all' | ItemType;

export function ItemsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get('tab') ?? 'all') as Tab;
  const tag = searchParams.get('tag') ?? '';
  const q = searchParams.get('q') ?? '';

  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(q);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importFailed, setImportFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchItems = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.listItems({
          type: tab === 'all' ? undefined : tab,
          q: q || undefined,
          tag: tag || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        setItems((prev) => (offset === 0 ? result.items : [...prev, ...result.items]));
        setTotal(result.total);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [tab, q, tag],
  );

  useEffect(() => {
    void fetchItems(0);
  }, [fetchItems]);

  // 导入耗时较长，期间用户可能切了标签页 / 改了搜索词；
  // 用 ref 持有最新的 fetchItems，保证导入结束后刷新的是当前筛选条件
  const fetchItemsRef = useRef(fetchItems);
  useEffect(() => {
    fetchItemsRef.current = fetchItems;
  }, [fetchItems]);

  const runImport = useCallback(async () => {
    if (importing) return;
    if (!window.confirm('从 X 书签导入全部收藏推文？已收录的链接会自动跳过。')) return;
    setImporting(true);
    setImportResult(null);
    setImportFailed(false);
    try {
      const r = await api.importXBookmarks();
      setImportResult(`书签导入完成：新增 ${r.imported} 条，跳过已收录 ${r.skipped} 条${r.failed ? `，失败 ${r.failed} 条` : ''}`);
      setImportFailed(r.failed > 0);
      await Promise.all([fetchItemsRef.current(0), api.listTags().then(setTags).catch(() => setTags([]))]);
    } catch (e) {
      setImportResult(e instanceof Error ? e.message : '书签导入失败');
      setImportFailed(true);
    } finally {
      setImporting(false);
    }
  }, [importing]);

  useEffect(() => {
    api
      .listTags()
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  // 搜索防抖：输入停止 400ms 后写入 URL 参数
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (searchInput === q) return;
    debounceRef.current = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchInput) next.set('q', searchInput);
      else next.delete('q');
      setSearchParams(next, { replace: true });
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput, q, searchParams, setSearchParams]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const hasFilter = Boolean(q || tag || tab !== 'all');

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 space-y-3 border-b border-zinc-200 px-6 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold">收录列表</h1>
          <span className="text-xs text-zinc-400">{total} 条</span>
          <div className="flex-1" />
          <button
            type="button"
            disabled={importing}
            onClick={() => void runImport()}
            title="用根目录 x.cookie.json 的登录态拉取 X 书签并收录"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {importing ? <Loader2 size={13} className="animate-spin" /> : <BookmarkCheck size={13} />}
            {importing ? '导入中…' : '从 X 书签导入'}
          </button>
        </div>

        {importResult && (
          <p className={`rounded-lg border px-3 py-2 text-xs ${importFailed ? 'border-red-200 bg-red-50 text-red-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {importResult}
          </p>
        )}

        <div className="flex items-center gap-1.5">
          {(['all', 'tweet', 'article', 'website', 'github'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setParam('tab', t === 'all' ? '' : t)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                tab === t
                  ? 'border-zinc-800 bg-zinc-800 text-white'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {t === 'all' ? '全部' : TYPE_META[t].label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex w-64 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
            <Search size={14} className="shrink-0 text-zinc-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="全文搜索标题 / 摘要 / 正文"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-400"
            />
            {searchInput && (
              <button type="button" onClick={() => setSearchInput('')} className="text-zinc-400 hover:text-zinc-600">
                <X size={13} />
              </button>
            )}
          </div>
          {tags.length > 0 && (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {tag && (
                <button
                  type="button"
                  onClick={() => setParam('tag', '')}
                  className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
                >
                  #{tag} <X size={11} />
                </button>
              )}
              {!tag &&
                tags.slice(0, 12).map(({ tag: t, count }) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setParam('tag', t)}
                    className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 transition hover:bg-zinc-200"
                  >
                    #{t} <span className="text-zinc-400">{count}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading && items.length === 0 ? (
          <p className="pt-16 text-center text-sm text-zinc-400">加载中…</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 pt-20 text-zinc-400">
            <Inbox size={32} />
            <p className="text-sm">{hasFilter ? '没有匹配的收录' : '还没有收录内容'}</p>
            <p className="text-xs">回到对话页粘贴链接，Agent 会自动收录</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <Link
                key={item.id}
                to={`/items/${item.id}`}
                className="block rounded-xl border border-zinc-200 bg-white px-4 py-3 transition hover:border-zinc-300 hover:shadow-sm"
              >
                <div className="flex items-start gap-2.5">
                  <TypeBadge type={item.type} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{item.summary}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-400">
                      <span className="truncate">{hostOf(item.url)}</span>
                      <span>·</span>
                      <span>{relativeTime(item.updatedAt)}</span>
                      {item.tags.slice(0, 4).map((t) => (
                        <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500">
                          #{t}
                        </span>
                      ))}
                      {item.tags.length > 4 && <span>+{item.tags.length - 4}</span>}
                    </div>
                  </div>
                </div>
              </Link>
            ))}

            {items.length < total && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void fetchItems(items.length)}
                  className="rounded-lg border border-zinc-200 px-4 py-1.5 text-xs text-zinc-600 transition hover:border-zinc-300 disabled:opacity-50"
                >
                  {loading ? '加载中…' : `加载更多（${items.length}/${total}）`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
