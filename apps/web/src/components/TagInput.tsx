import { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  /** 提交（失焦/回车时触发保存） */
  onCommit: (tags: string[]) => void;
}

/** 标签编辑器：Enter 添加，点击 × 删除，失焦提交 */
export function TagInput({ tags, onChange, onCommit }: TagInputProps) {
  const [input, setInput] = useState('');

  const commit = (next: string[]) => {
    onChange(next);
    onCommit(next);
  };

  const add = () => {
    const value = input.trim().toLowerCase();
    if (!value || tags.includes(value)) {
      setInput('');
      return;
    }
    commit([...tags, value]);
    setInput('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      commit(tags.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
        >
          {tag}
          <button
            type="button"
            className="text-zinc-400 hover:text-zinc-600"
            onClick={() => commit(tags.filter((t) => t !== tag))}
            aria-label={`删除标签 ${tag}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={tags.length === 0 ? '添加标签，回车确认' : ''}
        className="min-w-24 flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-400"
      />
    </div>
  );
}
