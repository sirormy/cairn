import { Feather, FileText, GitFork, Globe } from 'lucide-react';
import type { ItemType } from '@cairn/shared';

export const TYPE_META: Record<
  ItemType,
  { label: string; icon: typeof Globe; className: string }
> = {
  tweet: { label: '推文', icon: Feather, className: 'bg-sky-50 text-sky-700 border-sky-200' },
  article: { label: '文章', icon: FileText, className: 'bg-amber-50 text-amber-700 border-amber-200' },
  website: { label: '官网', icon: Globe, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  github: { label: 'GitHub', icon: GitFork, className: 'bg-violet-50 text-violet-700 border-violet-200' },
};

export function TypeBadge({ type, className = '' }: { type: ItemType; className?: string }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className} ${className}`}
    >
      <Icon size={12} />
      {meta.label}
    </span>
  );
}
