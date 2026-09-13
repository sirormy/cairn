import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Inbox, MessageSquare, Plus, Sparkles, Trash } from 'lucide-react';
import type { ConversationSummary } from '@app/shared';
import { api, notifyConversationsChanged } from '../lib/api';
import { relativeTime } from '../lib/format';

export function Sidebar() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const refresh = useCallback(() => {
    api
      .listConversations()
      .then(setConversations)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载失败'));
  }, []);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener('app:conversations-changed', handler);
    return () => window.removeEventListener('app:conversations-changed', handler);
  }, [refresh, location.pathname]);

  // 当前对话 id（高亮用）
  const activeId = location.pathname.startsWith('/c/') ? location.pathname.slice(3) : null;

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('删除该对话？对话中的消息将一并删除。')) return;
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      notifyConversationsChanged();
      if (activeId === id) navigate('/');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/80">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <span className="flex size-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <Sparkles size={15} />
        </span>
        <span className="text-sm font-semibold tracking-wide">收集箱</span>
      </div>

      <nav className="space-y-0.5 px-2">
        <Link
          to="/"
          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
            location.pathname === '/'
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-600 hover:bg-white/70'
          }`}
        >
          <MessageSquare size={15} className="text-zinc-400" />
          对话
        </Link>
        <Link
          to="/items"
          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition ${
            location.pathname.startsWith('/items')
              ? 'bg-white text-zinc-900 shadow-sm'
              : 'text-zinc-600 hover:bg-white/70'
          }`}
        >
          <Inbox size={15} className="text-zinc-400" />
          收录列表
        </Link>
      </nav>

      <div className="px-4 pt-5 pb-2">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          <Plus size={14} />
          新对话
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {error && <p className="px-2 py-2 text-xs text-red-500">{error}</p>}
        {conversations.map((conv) => (
          <Link
            key={conv.id}
            to={`/c/${conv.id}`}
            className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition ${
              activeId === conv.id
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:bg-white/70'
            }`}
            title={conv.title}
          >
            <span className="min-w-0 flex-1 truncate">{conv.title}</span>
            <span className="shrink-0 text-[11px] text-zinc-400 group-hover:hidden">
              {relativeTime(conv.updatedAt)}
            </span>
            <button
              type="button"
              onClick={(e) => handleDelete(e, conv.id)}
              className="hidden shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-red-500 group-hover:block"
              aria-label={`删除对话 ${conv.title}`}
            >
              <Trash size={13} />
            </button>
          </Link>
        ))}
      </div>
    </aside>
  );
}
