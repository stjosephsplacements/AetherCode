/**
 * The languages the platform's judge runs, keyed exactly as the platform stores them in
 * qbank.question_versions.supported_languages. `engine` is the hosted engine's own name for the same language
 * (backend/services/judge/internal/adapters/aethercode/languages.go).
 */
export const LANGUAGES = {
  c: { label: "C", engine: "c", monaco: "c", timeMultiplier: 1, template: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n" },
  cpp17: { label: "C++ 17", engine: "cpp", monaco: "cpp", timeMultiplier: 1, template: "#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n" },
  java: { label: "Java", engine: "java", monaco: "java", timeMultiplier: 2, template: "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        \n    }\n}\n" },
  python3: { label: "Python 3", engine: "python", monaco: "python", timeMultiplier: 2, template: "def main():\n    pass\n\n\nif __name__ == \"__main__\":\n    main()\n" },
  javascript: { label: "JavaScript", engine: "javascript", monaco: "javascript", timeMultiplier: 2, template: "const lines = require(\"fs\").readFileSync(0, \"utf8\").split(\"\\n\");\n" },
  go: { label: "Go", engine: "go", monaco: "go", timeMultiplier: 1, template: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println()\n}\n" },
  rust: { label: "Rust", engine: "rust", monaco: "rust", timeMultiplier: 1, template: "use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n}\n" },
  ruby: { label: "Ruby", engine: "ruby", monaco: "ruby", timeMultiplier: 2, template: "input = STDIN.read\n" },
  php: { label: "PHP", engine: "php", monaco: "php", timeMultiplier: 2, template: "<?php\n$input = stream_get_contents(STDIN);\n" },
  csharp: { label: "C#", engine: "csharp", monaco: "csharp", timeMultiplier: 2, template: "using System;\n\nclass Program {\n    static void Main() {\n        \n    }\n}\n" },
  bash: { label: "Bash", engine: "bash", monaco: "shell", timeMultiplier: 1, template: "read -r line\n" },
  sqlite: { label: "SQLite", engine: "sqlite", monaco: "sql", timeMultiplier: 1, template: "SELECT 1;\n" },
} as const;

export type LanguageId = keyof typeof LANGUAGES;
export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];
export const isLanguageId = (value: string): value is LanguageId => Object.hasOwn(LANGUAGES, value);
