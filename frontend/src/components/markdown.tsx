import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";

/**
 * Staff-written Markdown (instructions, question statements) with LaTeX maths: `$x^2$` inline, `$$...$$` as a
 * block (ADR-0070). Raw HTML is not rendered. The question intake app renders statements the same way.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-exam", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
