import type { Monaco } from "@monaco-editor/react";
import type { languages } from "monaco-editor";
import type { LanguageId } from "@/lib/languages";

type Item = { label: string; kind: number; insertText: string; insertTextRules?: number; detail?: string };

const registered = new Set<string>();

export function registerCompletions(monaco: Monaco, language: LanguageId): void {
  const monacoLang = { c: "c", cpp: "cpp", java: "java", python: "python" }[language];
  const key = `completions:${monacoLang}`;
  if (registered.has(key)) return;
  registered.add(key);

  const Kind = monaco.languages.CompletionItemKind;
  const SNIPPET = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const items = COMPLETIONS[language](Kind, SNIPPET);

  monaco.languages.registerCompletionItemProvider(monacoLang, {
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: items.map((item) => ({
          ...item,
          range,
        })) as languages.CompletionItem[],
      };
    },
  });
}

type K = typeof import("monaco-editor").languages.CompletionItemKind;
type R = typeof import("monaco-editor").languages.CompletionItemInsertTextRule;

const COMPLETIONS: Record<LanguageId, (Kind: K, SNIPPET: R["InsertAsSnippet"]) => Item[]> = {
  c: (Kind, SNIPPET) => [
    ...kw("auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while", Kind.Keyword),
    ...fn("printf scanf puts gets getchar putchar malloc calloc realloc free memset memcpy strlen strcpy strcmp strcat qsort abs sqrt pow", Kind.Function),
    { label: "main", kind: Kind.Snippet, detail: "program skeleton", insertText: '#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n    $0\n    return 0;\n}', insertTextRules: SNIPPET },
    { label: "for", kind: Kind.Snippet, detail: "loop", insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    $0\n}', insertTextRules: SNIPPET },
    { label: "scanf", kind: Kind.Snippet, detail: "read int", insertText: 'scanf("%d", &${1:x});', insertTextRules: SNIPPET },
    { label: "printf", kind: Kind.Snippet, detail: "print int", insertText: 'printf("%d\\n", ${1:x});', insertTextRules: SNIPPET },
  ],
  cpp: (Kind, SNIPPET) => [
    ...kw("auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false class public private protected namespace using template typename new delete nullptr this try catch throw const_cast static_cast virtual override operator", Kind.Keyword),
    ...fn("std cin cout cerr endl string vector map unordered_map set unordered_set pair queue priority_queue stack deque array bitset sort reverse min max swap abs begin end size push_back pop_back emplace_back insert erase find count lower_bound upper_bound accumulate getline make_pair to_string stoi stoll", Kind.Function),
    { label: "main", kind: Kind.Snippet, detail: "program skeleton", insertText: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    $0\n    return 0;\n}', insertTextRules: SNIPPET },
    { label: "for", kind: Kind.Snippet, detail: "loop", insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    $0\n}', insertTextRules: SNIPPET },
    { label: "forr", kind: Kind.Snippet, detail: "range loop", insertText: 'for (auto& ${1:x} : ${2:v}) {\n    $0\n}', insertTextRules: SNIPPET },
    { label: "vector", kind: Kind.Snippet, detail: "vector of n", insertText: 'vector<${1:int}> ${2:v}(${3:n});', insertTextRules: SNIPPET },
  ],
  java: (Kind, SNIPPET) => [
    ...kw("abstract boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true false try void while var", Kind.Keyword),
    ...fn("String Integer Long Double Character Boolean Math System Scanner BufferedReader InputStreamReader StringBuilder ArrayList LinkedList HashMap TreeMap HashSet TreeSet ArrayDeque PriorityQueue Arrays Collections List Map Set Queue Deque", Kind.Class),
    { label: "main", kind: Kind.Snippet, detail: "program skeleton", insertText: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        $0\n    }\n}', insertTextRules: SNIPPET },
    { label: "sout", kind: Kind.Snippet, detail: "System.out.println", insertText: 'System.out.println($0);', insertTextRules: SNIPPET },
    { label: "for", kind: Kind.Snippet, detail: "loop", insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    $0\n}', insertTextRules: SNIPPET },
    { label: "nextInt", kind: Kind.Snippet, detail: "read int", insertText: 'int ${1:n} = sc.nextInt();', insertTextRules: SNIPPET },
  ],
  python: (Kind, SNIPPET) => [
    ...fn("input print int str float list dict set tuple len range enumerate zip map filter sorted reversed sum min max abs any all open isinstance", Kind.Function),
    { label: "for", kind: Kind.Snippet, detail: "range loop", insertText: 'for ${1:i} in range(${2:n}):\n    $0', insertTextRules: SNIPPET },
    { label: "readint", kind: Kind.Snippet, detail: "read int", insertText: '${1:n} = int(input())', insertTextRules: SNIPPET },
    { label: "readlist", kind: Kind.Snippet, detail: "read ints", insertText: '${1:a} = list(map(int, input().split()))', insertTextRules: SNIPPET },
    { label: "main", kind: Kind.Snippet, detail: "program skeleton", insertText: 'def main():\n    $0\n\n\nif __name__ == "__main__":\n    main()', insertTextRules: SNIPPET },
  ],
};

function kw(words: string, kind: number): Item[] {
  return words.split(" ").map((w) => ({ label: w, kind, insertText: w }));
}

function fn(words: string, kind: number): Item[] {
  return words.split(" ").map((w) => ({ label: w, kind, insertText: w }));
}
