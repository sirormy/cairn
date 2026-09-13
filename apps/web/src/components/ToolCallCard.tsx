import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, Feather, GitFork, Globe, LoaderCircle, Save, Search, X } from 'lucide-react';
import type { ToolCallView } from '@app/shared';

const TOOL_META: Record<string, { icon: typeof Globe; label: string }> = {
  fetch_webpage: { icon: Globe, label: '抓取网页' },
  fetch_tweet: { icon: Feather, label: '抓取推文' },
  github_repo_info: { icon: GitFork, label: '调研仓库' },
  save_item: { icon: Save, label: '收录' },
  search_collection: { icon: Search, label: '检索收藏' },
};

function argSummary(args: Record<string, unknown>): string {
  if (typeof args.url === 'string') return args.url;
  if (typeof args.query === 'string') return args.query;
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}: ${String(args[k])}`).join(', ');
}

/** 工具调用卡片：状态徽标 + 可折叠的参数与结果预览 */
export function ToolCallCard({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[call.name] ?? { icon: Search, label: call.name };
  const Icon = meta.icon;

  const statusIcon =
    call.status === 'running' ? (
      <LoaderCircle size={13} className="animate-spin text-indigo-500" />
    ) : call.status === 'ok' ? (
      <span className="text-emerald-600" title="成功">
        ✓
      </span>
    ) : (
      <X size={13} className="text-red-500" />
    );

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <Icon size={13} className="shrink-0 text-zinc-500" />
        <span className="font-medium text-zinc-700">{meta.label}</span>
        {call.status !== 'running' && argSummary(call.args) && (
          <span className="min-w-0 flex-1 truncate text-zinc-400">{argSummary(call.args)}</span>
        )}
        {call.status === 'running' && <span className="text-zinc-400">执行中…</span>}
        {call.itemId && (
          <Link
            to={`/items/${call.itemId}`}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 hover:bg-emerald-100"
            title="查看收录详情"
          >
            已收录 →
          </Link>
        )}
        <span className="ml-auto shrink-0">{statusIcon}</span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-zinc-200 px-2.5 py-2 text-zinc-500">
          <div>
            <span className="font-medium text-zinc-600">参数</span>
            <pre className="mt-0.5 max-h-40 overflow-auto rounded bg-white p-1.5 text-[11px] leading-relaxed">
              {JSON.stringify(call.args, null, 2)}
            </pre>
          </div>
          {call.resultPreview && (
            <div>
              <span className="font-medium text-zinc-600">结果</span>
              <pre className="mt-0.5 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-white p-1.5 text-[11px] leading-relaxed">
                {call.resultPreview}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
