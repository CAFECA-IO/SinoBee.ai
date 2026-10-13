import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

/** Render untrusted markdown safely (no raw HTML, sanitized) */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-sb text-[15px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
