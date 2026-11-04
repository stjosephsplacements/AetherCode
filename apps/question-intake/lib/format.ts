/**
 * The platform's statement format (docs: ADR-0070): GitHub-flavoured Markdown with LaTeX math, `$...$` inline and
 * `$$...$$` as a block, rendered with KaTeX, in sections the practice screen and the exam screen both read:
 *
 *   <statement>
 *
 *   ## Input Format
 *   ## Output Format
 *   ## Constraints
 *   ## Note
 *
 * `toPlatformMarkdown` turns what an author pastes (plain text, Unicode maths, "10^5", "1 <= n <= 10^5") into that
 * format. It is idempotent: text already in the format comes back unchanged, so it can run on every save.
 */

const SYMBOLS: [RegExp, string][] = [
  [/≤|⩽/g, "\\le"],
  [/≥|⩾/g, "\\ge"],
  [/≠/g, "\\ne"],
  [/×/g, "\\times"],
  [/÷/g, "\\div"],
  [/·|⋅/g, "\\cdot"],
  [/∑/g, "\\sum"],
  [/∏/g, "\\prod"],
  [/√/g, "\\sqrt"],
  [/π/g, "\\pi"],
  [/∞/g, "\\infty"],
  [/∈/g, "\\in"],
  [/∉/g, "\\notin"],
  [/⊆/g, "\\subseteq"],
  [/⊂/g, "\\subset"],
  [/∪/g, "\\cup"],
  [/∩/g, "\\cap"],
  [/→/g, "\\to"],
  [/⇒/g, "\\Rightarrow"],
  [/∀/g, "\\forall"],
  [/∃/g, "\\exists"],
  [/∅/g, "\\emptyset"],
  [/±/g, "\\pm"],
  [/α/g, "\\alpha"],
  [/β/g, "\\beta"],
  [/θ/g, "\\theta"],
  [/λ/g, "\\lambda"],
  [/μ/g, "\\mu"],
  [/σ/g, "\\sigma"],
  [/Σ/g, "\\Sigma"],
  [/Δ/g, "\\Delta"],
  [/⌊/g, "\\lfloor "],
  [/⌋/g, "\\rfloor"],
  [/⌈/g, "\\lceil "],
  [/⌉/g, "\\rceil"],
];

const SUPERSCRIPTS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "ⁿ": "n" };
const SUBSCRIPTS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "ᵢ": "i", "ⱼ": "j", "ₙ": "n" };

/** Splits text into code and math spans, which are never touched, and the prose between them. */
function segments(text: string): { text: string; prose: boolean }[] {
  const parts: { text: string; prose: boolean }[] = [];
  const keep = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g;
  let last = 0;
  for (const match of text.matchAll(keep)) {
    if (match.index! > last) parts.push({ text: text.slice(last, match.index), prose: true });
    parts.push({ text: match[0], prose: false });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), prose: true });
  return parts;
}

const TOKEN = new RegExp(
  [
    String.raw`sqrt\([^()\n]*\)`,
    String.raw`(?<![A-Za-z0-9_])[A-Za-z](?![A-Za-z])(?:_\{?[A-Za-z0-9]+\}?|\[[A-Za-z0-9+\-]+\])?(?:\^\{?-?[A-Za-z0-9]+\}?)?`,
    String.raw`(?<![A-Za-z0-9_.])\d+(?:\.\d+)?(?:\^\{?-?[A-Za-z0-9]+\}?)?(?![A-Za-z0-9_])`,
    String.raw`<=|>=|!=|==|[<>=+*^/-]`,
    String.raw`[≤≥≠×÷·∑∏√π∞∈∉⊆⊂∪∩→⇒∀∃∅±αβθλμσΣΔ]`,
  ].join("|"),
  "g",
);
const SYMBOL_LATEX = new Map(SYMBOLS.map(([pattern, replacement]) => [pattern.source.replace(/\|\|.*$/, "").replace(/[|].*/, ""), replacement]));

type Token = { text: string; start: number; end: number; kind: "operand" | "operator" };

const OPERATOR_TOKEN = /^(?:<=|>=|!=|==|[<>=+*^/\-]|[≤≥≠×÷·])$/;
const SYMBOL_TOKEN = /^[∑∏√π∞∈∉⊆⊂∪∩→⇒∀∃∅±αβθλμσΣΔ]$/;

function tokens(prose: string): Token[] {
  const found: Token[] = [];
  for (const match of prose.matchAll(TOKEN)) {
    const text = match[0];
    found.push({ text, start: match.index!, end: match.index! + text.length, kind: OPERATOR_TOKEN.test(text) || SYMBOL_TOKEN.test(text) && text !== "π" && text !== "∞" && text !== "∅" && !/^[αβθλμσΣΔ]$/.test(text) ? "operator" : "operand" });
  }
  return found;
}

/** One token as LaTeX. */
function tokenLatex(text: string): string {
  const symbol = SYMBOLS.find(([pattern]) => new RegExp(`^(?:${pattern.source})$`).test(text));
  if (symbol) return symbol[1];
  if (text === "<=") return "\\le";
  if (text === ">=") return "\\ge";
  if (text === "!=") return "\\ne";
  if (text === "==") return "=";
  if (text === "*") return "\\cdot";
  return text
    .replace(/sqrt\(([^()]*)\)/, "\\sqrt{$1}")
    .replace(/\^(-?[A-Za-z0-9]+)(?!\})/g, "^{$1}")
    .replace(/_([A-Za-z0-9]+)(?!\})/g, "_{$1}")
    .replace(/\[([A-Za-z0-9+\-]+)\]/g, "_{$1}");
}

const RELATIONS = new Set(["<", ">", "<=", ">=", "!=", "==", "=", "≤", "≥", "≠"]);

/** Whether a run of tokens reads as maths rather than prose punctuation. */
function isMath(run: Token[]): boolean {
  const texts = run.map((token) => token.text);
  if (texts.some((text) => RELATIONS.has(text) || text === "^" || text === "*" || /[_^[]|^sqrt/.test(text) || SYMBOL_TOKEN.test(text) || /^[×÷·]$/.test(text))) return true;
  const letter = run.some((token) => /^[A-Za-z]/.test(token.text) && token.kind === "operand");
  const digit = run.some((token) => /^\d/.test(token.text));
  const plus = texts.includes("+");
  const minus = texts.includes("-") || texts.includes("/");
  return (plus && letter) || (minus && letter && digit);
}

/** Prose with Unicode maths and ASCII maths turned into `$...$`. */
function mathify(prose: string): string {
  // Superscript and subscript characters: 10⁵ -> 10^{5}, aᵢ -> a_{i}.
  let text = prose
    .replace(/([A-Za-z0-9)])([⁰¹²³⁴⁵⁶⁷⁸⁹⁻ⁿ]+)/g, (_, base: string, power: string) => `${base}^{${[...power].map((c) => SUPERSCRIPTS[c] ?? c).join("")}}`)
    .replace(/([A-Za-z])([₀₁₂₃₄₅₆₇₈₉ᵢⱼₙ]+)/g, (_, base: string, sub: string) => `${base}_{${[...sub].map((c) => SUBSCRIPTS[c] ?? c).join("")}}`);
  const list = tokens(text);
  const runs: Token[][] = [];
  let current: Token[] = [];
  for (const token of list) {
    const previous = current[current.length - 1];
    const gap = previous ? text.slice(previous.end, token.start) : "";
    const joined = previous !== undefined && /^[ \t]{0,2}$/.test(gap) && (previous.kind !== token.kind || previous.text === "√");
    if (current.length > 0 && !joined) {
      runs.push(current);
      current = [];
    }
    current.push(token);
  }
  if (current.length > 0) runs.push(current);

  let out = "";
  let cursor = 0;
  for (const raw of runs) {
    const run = [...raw];
    // A sign belongs to its number only when it touches it and is not a binary operator.
    while (run.length > 0 && run[0]!.kind === "operator" && !(run[0]!.text === "-" && run.length > 1 && run[0]!.end === run[1]!.start && /(^|[\s(])$/.test(text.slice(0, run[0]!.start)))) run.shift();
    while (run.length > 0 && run[run.length - 1]!.kind === "operator") run.pop();
    if (run.length === 0 || !isMath(run)) continue;
    const start = run[0]!.start;
    const end = run[run.length - 1]!.end;
    if (start < cursor) continue;
    const body = run.map((token, index) => `${index > 0 && run[index - 1]!.text !== "√" && !(index === 1 && run[0]!.text === "-" && run[0]!.end === run[1]!.start) ? " " : ""}${tokenLatex(token.text)}`).join("").replace(/\s+/g, " ").trim();
    out += text.slice(cursor, start) + `$${body}$`;
    cursor = end;
  }
  return out + text.slice(cursor);
}

const SECTIONS: { heading: string; pattern: RegExp }[] = [
  { heading: "Input Format", pattern: /^(?:#{1,6}\s*)?\**(?:input(?:\s+format|\s+description|\s+specification)?|inputs?)\**\s*[:.\-]?\s*\**\s*$/i },
  { heading: "Output Format", pattern: /^(?:#{1,6}\s*)?\**(?:output(?:\s+format|\s+description|\s+specification)?|outputs?)\**\s*[:.\-]?\s*\**\s*$/i },
  { heading: "Constraints", pattern: /^(?:#{1,6}\s*)?\**(?:constraints?|limits?|bounds?)\**\s*[:.\-]?\s*\**\s*$/i },
  { heading: "Note", pattern: /^(?:#{1,6}\s*)?\**(?:notes?|explanation|hints?|remarks?)\**\s*[:.\-]?\s*\**\s*$/i },
];

const INLINE_SECTION = /^(?:#{1,6}\s*)?\**(input(?:\s+format)?|output(?:\s+format)?|constraints?|notes?)\**\s*[:\-]\s*\**\s*(\S.*)$/i;
const HEADING_OF: Record<string, string> = { input: "Input Format", "input format": "Input Format", output: "Output Format", "output format": "Output Format", constraint: "Constraints", constraints: "Constraints", note: "Note", notes: "Note" };

/** True when the text already has the platform's section headings. */
export const hasSections = (text: string) => /^##\s+(Input Format|Output Format|Constraints|Note)\s*$/m.test(text);

export type Formatted = { markdown: string; changed: boolean };

/** Converts what an author pasted into the platform's statement format. Idempotent. */
export function toPlatformMarkdown(raw: string): Formatted {
  const original = raw;
  let text = raw.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();
  if (!text) return { markdown: "", changed: original !== "" };

  // Section labels become headings, on their own line or with the content after a colon.
  if (!hasSections(text)) {
    const lines = text.split("\n");
    const out: string[] = [];
    let inFence = false;
    for (const line of lines) {
      if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;
      if (inFence) {
        out.push(line);
        continue;
      }
      const trimmed = line.trim();
      const section = SECTIONS.find(({ pattern }) => pattern.test(trimmed));
      const inline = trimmed.match(INLINE_SECTION);
      if (section) out.push("", `## ${section.heading}`, "");
      else if (inline) out.push("", `## ${HEADING_OF[inline[1]!.toLowerCase()]}`, "", inline[2]!);
      else out.push(line);
    }
    text = out.join("\n");
  }

  // Constraint lines become a list, as the practice screen styles them.
  text = text.replace(/(^## Constraints\n\n?)([\s\S]*?)(?=\n## |\s*(?![\s\S]))/m, (_, heading: string, body: string) => {
    const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0 || lines.some((line) => /^(```|~~~)/.test(line))) return heading + body;
    return `${heading.replace(/\n+$/, "\n\n")}${lines.map((line) => (/^([-*+]|\d+[.)])\s/.test(line) ? line.replace(/^([*+]|\d+[.)])\s/, "- ") : `- ${line}`)).join("\n")}\n`;
  });

  // Maths in the prose, never in code or existing maths.
  text = segments(text)
    .map((part) => (part.prose ? mathify(part.text) : part.text))
    .join("");

  text = text.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "") + "\n";
  return { markdown: text, changed: text !== original };
}

/** Option and explanation text: the same maths conversion, no sections. */
export function mathText(raw: string): string {
  return segments(raw)
    .map((part) => (part.prose ? mathify(part.text) : part.text))
    .join("")
    .trim();
}
