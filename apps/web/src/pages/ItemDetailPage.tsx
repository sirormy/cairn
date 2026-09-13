import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ChevronDown,
  ExternalLink,
  GitFork,
  Star,
  Trash,
} from 'lucide-react';
import type { ItemDetail } from '@app/shared';
import { Markdown } from '../components/Markdown';
import { TagInput } from '../components/TagInput';
import { TypeBadge } from '../components/TypeBadge';
import { api } from '../lib/api';
import { hostOf } from '../lib/format';

function num(v: unknown): string | null {
  return typeof v === 'number' ? v.toLocaleString('zh-CN') : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function MetricsRow({ item }: { item: ItemDetail }) {
  if (item.type === 'github') {
    const stars = num(item.metadata.stars);
    const forks = num(item.metadata.forks);
    const language = str(item.metadata.language);
    const license = str(item.metadata.license);
    const release = str(item.metadata.latestRelease);
    const pushedAt = str(item.metadata.pushedAt);
    const topics = Array.isArray(item.metadata.topics)
      ? (item.metadata.topics as unknown[]).filter((t): t is string => typeof t === 'string')
      : [];
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
          {stars && (
            <span className="inline-flex items-center gap-1">
              <Star size={13} className="text-amber-500" /> {stars}
            </span>
          )}
          {forks && (
            <span className="inline-flex items-center gap-1">
              <GitFork size={13} className="text-zinc-400" /> {forks}
            </span>
          )}
          {language && <span>{language}</span>}
          {license && <span>{license} 协议</span>}
          {release && <span>最新版本 {release}</span>}
          {pushedAt && <span className="text-zinc-400">最近更新 {pushedAt.slice(0, 10)}</span>}
        </div>
        {topics.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {topics.slice(0, 10).map((t) => (
              <span key={t} className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-600">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (item.type === 'tweet') {
    const author = item.metadata.author as { name?: unknown; handle?: unknown } | undefined;
    const metrics = item.metadata.metrics as
      | { replies?: unknown; reposts?: unknown; likes?: unknown }
      | undefined;
    const name = typeof author?.name === 'string' ? author.name : null;
    const handle = typeof author?.handle === 'string' ? author.handle : null;
    const likes = num(metrics?.likes);
    const reposts = num(metrics?.reposts);
    const replies = num(metrics?.replies);
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
        {name && <span className="font-medium text-zinc-800">{name}</span>}
        {handle && <span className="text-zinc-400">@{handle}</span>}
        {replies && <span>{replies} 回复</span>}
        {reposts && <span>{reposts} 转发</span>}
        {likes && <span>{likes} 赞</span>}
      </div>
    );
  }
  const siteName = str(item.metadata.siteName);
  const byline = str(item.metadata.byline);
  if (!siteName && !byline) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
      {siteName && <span>{siteName}</span>}
      {byline && <span className="text-zinc-400">{byline}</span>}
    </div>
  );
}

export function ItemDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    let cancelled = false;
    api
      .getItem(id)
      .then((detail) => {
        if (cancelled) return;
        setItem(detail);
        setNotes(detail.notes ?? '');
        setNotesDirty(false);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-400">
        <p className="text-sm">条目不存在</p>
        <Link to="/items" className="text-sm text-indigo-500 hover:underline">
          返回收录列表
        </Link>
      </div>
    );
  }

  if (!item) {
    return <p className="pt-20 text-center text-sm text-zinc-400">加载中…</p>;
  }

  const handleTagsCommit = async (tags: string[]) => {
    try {
      const updated = await api.updateItem(item.id, { tags });
      setItem({ ...item, tags: updated.tags, updatedAt: updated.updatedAt });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '保存失败');
    }
  };

  const handleNotesSave = async () => {
    if (!notesDirty) return;
    setSaveState('saving');
    try {
      await api.updateItem(item.id, { notes });
      setNotesDirty(false);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '保存失败');
      setSaveState('idle');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`删除「${item.title}」？缓存的原文将一并删除。`)) return;
    try {
      await api.deleteItem(item.id);
      navigate('/items');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '删除失败');
    }
  };

  const contentLabel =
    item.type === 'github' ? 'README 缓存' : item.type === 'tweet' ? '推文缓存' : '原文缓存';

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        <header className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <Link to="/items" className="text-xs text-zinc-400 hover:text-zinc-600">
              ← 收录列表
            </Link>
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 transition hover:border-red-200 hover:text-red-500"
            >
              <Trash size={12} />
              删除
            </button>
          </div>
          <div className="flex items-start gap-3">
            <TypeBadge type={item.type} className="mt-1" />
            <h1 className="min-w-0 flex-1 text-xl leading-snug font-semibold">{item.title}</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-indigo-500 hover:underline"
            >
              {hostOf(item.url)} <ExternalLink size={11} />
            </a>
            <span>收录于 {new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
        </header>

        <MetricsRow item={item} />

        <p className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-sm leading-relaxed text-zinc-600">
          {item.summary}
        </p>

        {item.report && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-zinc-800">调研报告</h2>
            <Markdown>{item.report}</Markdown>
          </section>
        )}

        {item.content && (
          <details className="group mt-6 rounded-xl border border-zinc-200">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-700">
              {contentLabel}
              <ChevronDown size={15} className="text-zinc-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-zinc-100 px-4 py-3">
              <Markdown>{item.content}</Markdown>
            </div>
          </details>
        )}

        <section className="mt-6 space-y-4 rounded-xl border border-zinc-200 px-4 py-3.5">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-zinc-500">标签</h3>
            <TagInput tags={item.tags} onChange={(tags) => setItem({ ...item, tags })} onCommit={handleTagsCommit} />
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-zinc-500">笔记</h3>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesDirty(true);
                setSaveState('idle');
              }}
              onBlur={handleNotesSave}
              rows={3}
              placeholder="记录你的想法…"
              className="w-full resize-y rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
            <div className="mt-1 flex h-4 items-center justify-end text-[11px] text-zinc-400">
              {saveState === 'saving' && '保存中…'}
              {saveState === 'saved' && '✓ 已保存'}
              {saveState === 'idle' && notesDirty && '未保存（失焦自动保存）'}
            </div>
          </div>
        </section>

        <div className="h-10" />
      </div>
    </div>
  );
}
