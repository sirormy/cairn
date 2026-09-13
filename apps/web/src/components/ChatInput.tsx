import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  /** 流式处理中禁用输入 */
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

/** 对话输入框：Enter 发送，Shift+Enter 换行，高度自适应 */
export function ChatInput({ onSend, onStop, busy = false, placeholder, autoFocus = false }: ChatInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  // 高度自适应：先重置再按内容撑开（配合 max-h）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  });

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    if (busy) return;
    const text = ref.current?.value.trim();
    if (!text) return;
    if (ref.current) ref.current.value = '';
    if (ref.current) ref.current.style.height = 'auto';
    onSend(text);
  };

  return (
    <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100">
      <textarea
        ref={ref}
        rows={1}
        placeholder={placeholder ?? '粘贴链接（推文 / 文章 / GitHub / 官网）或直接提问'}
        className="max-h-50 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-400"
        onKeyDown={handleKeyDown}
        disabled={busy && !onStop}
      />
      {busy && onStop ? (
        <button
          type="button"
          onClick={onStop}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-white transition hover:bg-zinc-700"
          title="停止"
        >
          <Square size={14} fill="currentColor" />
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-500 disabled:opacity-40"
          title="发送（Enter）"
        >
          <Send size={14} />
        </button>
      )}
    </div>
  );
}
