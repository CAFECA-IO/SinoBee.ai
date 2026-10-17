import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { escapeMoney } from "@/lib/markdown-money";

/**
 * Render untrusted markdown safely (no raw HTML, sanitized). Math ($…$, $$…$$) is typeset by KaTeX after
 * sanitizing, from the formula text only (KaTeX's own output is trusted; \href and friends stay disabled).
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-sb text-[15px]">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeSanitize, [rehypeKatex, { throwOnError: false, strict: "ignore" }]]}>
        {escapeMoney(children)}
      </ReactMarkdown>
    </div>
  );
}
