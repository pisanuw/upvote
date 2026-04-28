import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize from "rehype-sanitize";
import rehypeExternalLinks from "rehype-external-links";
import type { Components } from "react-markdown";

const markdownComponents: Components = {
  p: ({ children }) => <p className="mt-2 first:mt-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      {...props}
      className="text-teal-700 underline hover:text-teal-600"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="mt-2 list-disc pl-5 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal pl-5 space-y-1">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  pre: ({ children }) => (
    <pre className="mt-2 overflow-auto rounded-lg bg-slate-100 p-3 text-sm font-mono">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code
      className={
        className
          ? className
          : "rounded bg-slate-100 px-1 py-0.5 text-[0.875em] font-mono"
      }
    >
      {children}
    </code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-l-4 border-slate-300 pl-3 text-slate-600 italic">
      {children}
    </blockquote>
  ),
  h1: ({ children }) => <h1 className="mt-3 text-xl font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 text-lg font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-3 font-semibold">{children}</h3>,
  hr: () => <hr className="my-3 border-slate-200" />,
};

const rehypePlugins = [
  rehypeSanitize,
  [
    rehypeExternalLinks,
    { target: "_blank", rel: ["nofollow", "noopener", "noreferrer"] },
  ],
] as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"];

export function MarkdownContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
