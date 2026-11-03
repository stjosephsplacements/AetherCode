/** The languages the hosted engine runs. `id` is the engine's own name. */
export const LANGUAGES = {
  c: { label: "C", timeMultiplier: 1, template: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n" },
  cpp: { label: "C++", timeMultiplier: 1, template: "#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n" },
  java: { label: "Java", timeMultiplier: 2, template: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        \n    }\n}\n" },
  python: { label: "Python 3", timeMultiplier: 2, template: "def main():\n    pass\n\n\nif __name__ == \"__main__\":\n    main()\n" },
  javascript: { label: "JavaScript", timeMultiplier: 2, template: "const lines = require(\"fs\").readFileSync(0, \"utf8\").split(\"\\n\");\n" },
  go: { label: "Go", timeMultiplier: 1, template: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println()\n}\n" },
  rust: { label: "Rust", timeMultiplier: 1, template: "use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n}\n" },
  ruby: { label: "Ruby", timeMultiplier: 2, template: "input = STDIN.read\n" },
  php: { label: "PHP", timeMultiplier: 2, template: "<?php\n$input = stream_get_contents(STDIN);\n" },
  csharp: { label: "C#", timeMultiplier: 2, template: "using System;\n\nclass Program {\n    static void Main() {\n        \n    }\n}\n" },
} as const;

export type LanguageId = keyof typeof LANGUAGES;
export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];
export const isLanguageId = (value: string): value is LanguageId => Object.hasOwn(LANGUAGES, value);
