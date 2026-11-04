"use client";

import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/** The platform's statement renderer: GitHub-flavoured Markdown with LaTeX maths (`$...$`, `$$...$$`). Raw HTML is not rendered. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="statement text-[14px] leading-relaxed [&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:text-[15px] [&_h2]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2.5 [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-[var(--radius-control)] [&_pre]:bg-hover [&_pre]:p-2.5 [&_pre]:font-mono [&_pre]:text-[13px] [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
