# ADR-0070: One statement format, with maths, for the platform and the question intake

- Status: accepted
- Date: 2026-11-04

## Context

Questions are written in the question intake app (ADR-0069) and later imported into the platform's question bank.
The platform rendered statements with GitHub-flavoured Markdown only, so equations and notation had no format, and
plain-text statements pasted by authors had no shared structure.

## Decision

- **Format.** A statement is Markdown (GFM) with LaTeX maths, `$...$` inline and `$$...$$` as a block, rendered with
  KaTeX (`remark-math`, `rehype-katex`), in sections: the statement, then `## Input Format`, `## Output Format`,
  `## Constraints` (a list) and optionally `## Note`. Raw HTML is not rendered. The platform's `Markdown` component and the
  intake preview use the same plugins, so what authors preview is what students read.
- **Conversion.** `toPlatformMarkdown` (apps/question-intake/lib/format.ts) turns pasted plain text into that format on
  every save, and on request: section labels become headings, constraint lines a list, and maths (`1 <= n <= 10^5`,
  `a_i`, `sqrt(n)`, Unicode symbols and super/subscripts) LaTeX. It is idempotent and never touches code or existing
  maths. Multiple-choice options and explanations get the same maths conversion.
- **Data model.** The intake database mirrors the question bank: topics are categories (one level of sub-topics, names
  unique among siblings ignoring case), questions carry slug, kind, audience, tags, difficulty, platform language keys,
  limits, tests with sample/hidden and weight, choices with explanations, starter/wrapper code and model solutions. It
  applies the platform wizard's rules (a sample and a hidden test, slug and tag normalisation, limit ranges), and
  `/api/export` emits questions in the platform's shape.

## Consequences

- A question written in the intake imports without reshaping.
- The platform gains three pinned dependencies (katex, remark-math, rehype-katex).
