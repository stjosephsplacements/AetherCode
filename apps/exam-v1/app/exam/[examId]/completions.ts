import { completeAnyWord, completeFromList, snippetCompletion as snippet, type Completion } from "@codemirror/autocomplete";
import { cppLanguage } from "@codemirror/lang-cpp";
import { javaLanguage } from "@codemirror/lang-java";
import { pythonLanguage } from "@codemirror/lang-python";
import type { Extension } from "@uiw/react-codemirror";
import type { LanguageId } from "@/lib/languages";

// Editor autocompletion: language keywords, common library names and snippets,
// plus every word already in the file. No types or semantics, like a plain IDE.

const keywords = (words: string) => words.split(" ").map((label): Completion => ({ label, type: "keyword" }));
const names = (words: string, type: string) => words.split(" ").map((label): Completion => ({ label, type }));

const C_KEYWORDS =
  "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while";

const C: Completion[] = [
  ...keywords(C_KEYWORDS),
  ...names("printf scanf puts gets getchar putchar malloc calloc realloc free memset memcpy strlen strcpy strcmp strcat qsort abs sqrt pow", "function"),
  snippet("#include <stdio.h>\n#include <stdlib.h>\n\nint main(void) {\n    ${}\n    return 0;\n}", { label: "main", detail: "program skeleton", type: "text" }),
  snippet("for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n    ${}\n}", { label: "for", detail: "loop", type: "keyword" }),
  snippet('scanf("%d", &${x});', { label: "scanf", detail: "read int", type: "function" }),
  snippet('printf("%d\\n", ${x});', { label: "printf", detail: "print int", type: "function" }),
];

const CPP: Completion[] = [
  ...keywords(
    `${C_KEYWORDS} bool true false class public private protected namespace using template typename new delete nullptr this try catch throw const_cast static_cast virtual override operator`,
  ),
  ...names(
    "std cin cout cerr endl string vector map unordered_map set unordered_set pair queue priority_queue stack deque array bitset sort reverse min max swap abs begin end size push_back pop_back emplace_back insert erase find count lower_bound upper_bound accumulate getline make_pair to_string stoi stoll",
    "function",
  ),
  snippet("#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    ${}\n    return 0;\n}", {
    label: "main",
    detail: "program skeleton",
    type: "text",
  }),
  snippet("for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n    ${}\n}", { label: "for", detail: "loop", type: "keyword" }),
  snippet("for (auto& ${x} : ${v}) {\n    ${}\n}", { label: "forr", detail: "range loop", type: "keyword" }),
  snippet("vector<${int}> ${v}(${n});", { label: "vector", detail: "vector of n", type: "class" }),
];

const JAVA: Completion[] = [
  ...keywords(
    "abstract boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true false try void while var",
  ),
  ...names(
    "String Integer Long Double Character Boolean Math System Scanner BufferedReader InputStreamReader StringBuilder ArrayList LinkedList HashMap TreeMap HashSet TreeSet ArrayDeque PriorityQueue Arrays Collections List Map Set Queue Deque",
    "class",
  ),
  snippet("import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        ${}\n    }\n}", {
    label: "main",
    detail: "program skeleton",
    type: "text",
  }),
  snippet("System.out.println(${});", { label: "sout", detail: "System.out.println", type: "function" }),
  snippet("for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n    ${}\n}", { label: "for", detail: "loop", type: "keyword" }),
  snippet("int ${n} = sc.nextInt();", { label: "nextInt", detail: "read int", type: "function" }),
];

const PYTHON: Completion[] = [
  ...names(
    "input print int str float list dict set tuple len range enumerate zip map filter sorted reversed sum min max abs any all open isinstance",
    "function",
  ),
  snippet("for ${i} in range(${n}):\n    ${}", { label: "for", detail: "range loop", type: "keyword" }),
  snippet("${n} = int(input())", { label: "readint", detail: "read int", type: "function" }),
  snippet("${a} = list(map(int, input().split()))", { label: "readlist", detail: "read ints", type: "function" }),
  snippet('def main():\n    ${}\n\n\nif __name__ == "__main__":\n    main()', { label: "main", detail: "program skeleton", type: "text" }),
];

/** Completion sources per exam language, added to the language's own (Python's scope completion). */
export const COMPLETIONS: Record<LanguageId, Extension[]> = {
  c: [cppLanguage.data.of({ autocomplete: completeFromList(C) }), cppLanguage.data.of({ autocomplete: completeAnyWord })],
  cpp: [cppLanguage.data.of({ autocomplete: completeFromList(CPP) }), cppLanguage.data.of({ autocomplete: completeAnyWord })],
  java: [javaLanguage.data.of({ autocomplete: completeFromList(JAVA) }), javaLanguage.data.of({ autocomplete: completeAnyWord })],
  python: [pythonLanguage.data.of({ autocomplete: completeFromList(PYTHON) }), pythonLanguage.data.of({ autocomplete: completeAnyWord })],
};
