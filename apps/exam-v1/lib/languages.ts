export type LanguageId = "c" | "cpp" | "java" | "python";

export interface Language {
  id: LanguageId;
  label: string;
  judge0Id: number;
  pistonName: string;
  fileName: string;
  timeMultiplier: number;
  template: string;
}

export const LANGUAGES: Record<LanguageId, Language> = {
  c: {
    id: "c",
    label: "C (GCC)",
    judge0Id: 50,
    pistonName: "c",
    fileName: "main.c",
    timeMultiplier: 1,
    template: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n",
  },
  cpp: {
    id: "cpp",
    label: "C++ (G++)",
    judge0Id: 54,
    pistonName: "c++",
    fileName: "main.cpp",
    timeMultiplier: 1,
    // Specific headers compile ~3x faster than <bits/stdc++.h>, which matters under exam load.
    template: "#include <iostream>\n#include <vector>\n#include <string>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n",
  },
  java: {
    id: "java",
    label: "Java",
    judge0Id: 62,
    pistonName: "java",
    fileName: "Main.java",
    timeMultiplier: 2,
    template:
      "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        \n    }\n}\n",
  },
  python: {
    id: "python",
    label: "Python 3",
    judge0Id: 71,
    pistonName: "python",
    fileName: "main.py",
    timeMultiplier: 2,
    template: "def main():\n    pass\n\n\nif __name__ == \"__main__\":\n    main()\n",
  },
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

export function isLanguageId(value: string): value is LanguageId {
  return Object.hasOwn(LANGUAGES, value);
}
