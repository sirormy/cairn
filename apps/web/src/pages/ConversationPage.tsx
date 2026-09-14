import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Pencil, Sparkles } from 'lucide-react';
import type { ChatMessage, ChatSSE } from '@cairn/shared';
import { ChatInput } from '../components/ChatInput';
import { Markdown } from '../components/Markdown';
import { ToolCallCard } from '../components/ToolCallCard';
import { api, notifyConversationsChanged, streamChat } from '../lib/api';
import { applyChatEvent } from '../lib/chat-events';

export function ConversationPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [title, setTitle] = useState('对话');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 当前会话 id：流式中途切换会话后，旧流事件按此丢弃 */
  const activeIdRef = useRef(id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const sentRef = useRef(false);

  /* ── 初始加载 ─────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    // 中断上一场仍在进行的 SSE 流，避免旧会话的事件写入本会话视图
    abortRef.current?.abort();
    activeIdRef.current = id;
    setLoaded(false);
    setMessages([]);
    setBusy(false);
    setError(null);
    sentRef.current = false;
    api
      .getConversation(id)
      .then((detail) => {
        if (cancelled) return;
        setTitle(detail.title);
        setMessages(detail.messages);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        navigate('/', { replace: true });
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [id, navigate]);

  /* ── SSE 事件 → 消息状态 ──────────────────────────── */

  const applyEvent = useCallback((e: ChatSSE) => {
    switch (e.event) {
      case 'done':
        setBusy(false);
        if (e.data.title) setTitle(e.data.title);
        notifyConversationsChanged();
        break;
      case 'error':
        setError(e.data.message);
        setBusy(false);
        break;
      default:
        setMessages((prev) => applyChatEvent(prev, e));
    }
  }, []);

  /* ── 发送 ─────────────────────────────────────────── */

  const sendMessage = useCallback(
    async (text: string) => {
      setError(null);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const streamConvId = id;
      // abort 后可能仍有已入队的事件到达，按会话 id 丢弃旧流
      const onEvent = (e: ChatSSE) => {
        if (activeIdRef.current === streamConvId) applyEvent(e);
      };
      try {
        await streamChat(id, text, onEvent, controller.signal);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError(e instanceof Error ? e.message : '发送失败');
        }
      } finally {
        if (activeIdRef.current === streamConvId) setBusy(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [id, applyEvent],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ── 首条消息自动发送（从首页带过来的 pendingText） ── */

  const pendingText = (location.state as { pendingText?: string } | null)?.pendingText;
  useEffect(() => {
    if (!loaded || !pendingText || sentRef.current) return;
    sentRef.current = true;
    // 清掉 state，刷新页面时不重发
    navigate(location.pathname, { replace: true });
    void sendMessage(pendingText);
  }, [loaded, pendingText, sendMessage, navigate, location.pathname]);

  /* ── 自动滚动（用户手动上滚时暂停跟随） ───────────── */

  useEffect(() => {
    if (nearBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const handleRename = async () => {
    const next = window.prompt('重命名对话', title);
    if (!next || !next.trim() || next.trim() === title) return;
    try {
      const conv = await api.renameConversation(id, next.trim());
      setTitle(conv.title);
      notifyConversationsChanged();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : '重命名失败');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-4">
        <span className="truncate text-sm font-medium">{title}</span>
        <button
          type="button"
          onClick={handleRename}
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          title="重命名"
        >
          <Pencil size={13} />
        </button>
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {loaded && messages.length === 0 && !busy && (
            <div className="flex flex-col items-center gap-3 pt-24 text-center text-zinc-400">
              <Sparkles size={28} />
              <p className="text-sm">输入链接或问题，Agent 将自动收录与调研</p>
              <p className="text-xs">
                或去{' '}
                <Link to="/items" className="text-indigo-500 hover:underline">
                  收录列表
                </Link>{' '}
                查看已收藏的内容
              </p>
            </div>
          )}

          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2 text-sm whitespace-pre-wrap text-white">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={m.id} className="space-y-2">
                {m.toolCalls.length > 0 && (
                  <div className="space-y-1.5">
                    {m.toolCalls.map((call) => (
                      <ToolCallCard key={call.id} call={call} />
                    ))}
                  </div>
                )}
                {m.text && <Markdown>{m.text}</Markdown>}
                {busy && m === messages[messages.length - 1] && !m.text && m.toolCalls.length === 0 && (
                  <span className="inline-block h-4 animate-pulse rounded-sm bg-indigo-400/60 px-1" />
                )}
              </div>
            ),
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-zinc-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <ChatInput onSend={sendMessage} onStop={handleStop} busy={busy} autoFocus />
        </div>
      </footer>
    </div>
  );
}
