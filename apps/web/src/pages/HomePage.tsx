import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Sparkles } from 'lucide-react';
import { ChatInput } from '../components/ChatInput';
import { api, notifyConversationsChanged } from '../lib/api';

/** 首页：居中大输入框，首条消息创建新对话后跳转 */
export function HomePage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      const conv = await api.createConversation();
      notifyConversationsChanged();
      navigate(`/c/${conv.id}`, { state: { pendingText: text } });
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建对话失败');
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-6">
      <div className="w-full max-w-2xl -translate-y-10">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
            <Sparkles size={24} />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">收集箱</h1>
          <p className="mt-2 text-sm text-zinc-500">
            粘贴链接（推文 / 文章 / GitHub / 官网）自动收录与调研，或直接提问
          </p>
        </div>

        <ChatInput onSend={handleSend} busy={busy} autoFocus placeholder="粘贴链接或输入问题…" />

        {error && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}

        <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-zinc-400">
          {['https://github.com/…', 'https://x.com/…/status/…', 'https://blog.example.com/post'].map(
            (hint) => (
              <code key={hint} className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1">
                {hint}
              </code>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
