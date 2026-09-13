import remarkGfm from 'remark-gfm';
import ReactMarkdown from 'react-markdown';

/** markdown 渲染（表格 / 任务列表 / 删除线等 GFM 语法） */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-zinc prose-sm max-w-none prose-headings:font-semibold prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
