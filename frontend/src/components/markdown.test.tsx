import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders LaTeX maths with KaTeX, inline and as a block", () => {
    const html = renderToStaticMarkup(<Markdown>{"Given $1 \\le n \\le 10^{5}$.\n\n$$\\sum_{i=1}^{n} a_i$$"}</Markdown>);
    expect(html).toContain('class="katex"');
    expect(html).toContain("katex-display");
    expect(html).not.toContain("$1");
  });

  it("keeps GitHub-flavoured Markdown and refuses raw HTML", () => {
    const html = renderToStaticMarkup(<Markdown>{"## Input Format\n\n- one\n- two\n\n<script>alert(1)</script>"}</Markdown>);
    expect(html).toContain("<h2>Input Format</h2>");
    expect(html).toContain("<li>one</li>");
    expect(html).not.toContain("<script>");
  });
});
