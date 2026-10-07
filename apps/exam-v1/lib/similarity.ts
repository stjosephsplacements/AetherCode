// Code-similarity detection (MOSS-style winnowing). Code is reduced to a token
// stream that ignores names, literals, comments and layout, k-grams of tokens are
// hashed, and a winnowed subset of hashes fingerprints each program. Pairs are
// scored by shared fingerprints; fingerprints most of the class shares
// (boilerplate, the obvious solution) are ignored.

const KEYWORDS = new Set(
  (
    "auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while " +
    "bool class delete false friend inline namespace new operator private protected public template this throw true try catch using virtual nullptr std cin cout endl vector string map set pair " +
    "abstract boolean byte extends final finally implements import instanceof interface native package super synchronized throws transient var null String System Scanner " +
    "and as assert async await def del elif except from global in is lambda nonlocal not or pass raise with yield None True False print input range len"
  ).split(" "),
);

const TOKEN =
  /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\w.]*)|([A-Za-z_]\w*)|(==|!=|<=|>=|&&|\|\||\+\+|--|<<|>>|->|::|\+=|-=|\*=|\/=|[{}()[\];,.<>+\-*/%=!&|^~?:])/g;

export function tokenize(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/(^|\s)#(?!include|define|import)[^\n]*/g, " ")
    .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, '""');
  const tokens: string[] = [];
  for (const match of withoutComments.matchAll(TOKEN)) {
    if (match[1]) tokens.push("S");
    else if (match[2]) tokens.push("N");
    else if (match[3]) tokens.push(KEYWORDS.has(match[3]) ? match[3] : "V");
    else tokens.push(match[4]);
  }
  return tokens;
}

const K = 8;
const WINDOW = 4;

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

export function fingerprints(source: string): Set<number> {
  const tokens = tokenize(source);
  const grams: number[] = [];
  for (let i = 0; i + K <= tokens.length; i++) {
    let h = 2166136261;
    for (let j = 0; j < K; j++) {
      if (j > 0) h = Math.imul(h ^ 32, 16777619); // space separator
      const tok = tokens[i + j];
      for (let c = 0; c < tok.length; c++) h = Math.imul(h ^ tok.charCodeAt(c), 16777619);
    }
    grams.push(h >>> 0);
  }
  const selected = new Set<number>();
  if (grams.length <= WINDOW) {
    grams.forEach((gram) => selected.add(gram));
    return selected;
  }
  // Monotonic deque sliding-window minimum: O(n) total, zero per-step allocations.
  const deque: number[] = []; // indices into grams
  for (let i = 0; i < grams.length; i++) {
    while (deque.length > 0 && grams[deque[deque.length - 1]] >= grams[i]) deque.pop();
    deque.push(i);
    if (deque[0] <= i - WINDOW) deque.shift();
    if (i >= WINDOW - 1) selected.add(grams[deque[0]]);
  }
  return selected;
}

export interface Document {
  id: string;
  source: string;
}

export interface SimilarPair {
  a: string;
  b: string;
  // Shared fingerprints over the smaller program's fingerprints (0..1).
  score: number;
  shared: number;
}

// Programs with fewer distinctive fingerprints than this are too small to judge.
const MIN_FINGERPRINTS = 6;

export function similarPairs(documents: Document[], { threshold = 0.6, commonFraction = 0.5 } = {}): SimilarPair[] {
  const prints = new Map(documents.map((document) => [document.id, fingerprints(document.source)]));
  const holders = new Map<number, string[]>();
  for (const [id, set] of prints) {
    for (const value of set) {
      let arr = holders.get(value);
      if (!arr) { arr = []; holders.set(value, arr); }
      arr.push(id);
    }
  }

  // Ignore what most of the class wrote: boilerplate and the canonical answer.
  // Capped so a 1000-student class does not count pairs for widely shared hashes.
  const commonLimit = Math.max(2, Math.min(50, Math.floor(documents.length * commonFraction)));
  const distinctive = new Map<string, number>();
  const shared = new Map<string, number>();
  for (const [, ids] of holders) {
    if (ids.length > commonLimit) continue;
    for (const id of ids) distinctive.set(id, (distinctive.get(id) ?? 0) + 1);
    for (let left = 0; left < ids.length; left++) {
      for (let right = left + 1; right < ids.length; right++) {
        const key = ids[left] < ids[right] ? `${ids[left]}\u0000${ids[right]}` : `${ids[right]}\u0000${ids[left]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }

  const pairs: SimilarPair[] = [];
  for (const [key, count] of shared) {
    const [a, b] = key.split("\u0000");
    const smaller = Math.min(distinctive.get(a) ?? 0, distinctive.get(b) ?? 0);
    if (smaller < MIN_FINGERPRINTS) continue;
    const score = count / smaller;
    if (score >= threshold) pairs.push({ a, b, score, shared: count });
  }
  return pairs.sort((x, y) => y.score - x.score || y.shared - x.shared);
}
