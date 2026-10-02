// Verifies the configured engine end to end: every language must produce the
// expected verdict for a correct, wrong, slow and broken program.
//
//   docker compose exec worker pnpm engine-check
import { engineFromEnv } from "../lib/engine.ts";
import { createLimiter, grade, type Verdict } from "../lib/grade.ts";
import type { LanguageId } from "../lib/languages.ts";

const PROGRAMS: Record<LanguageId, { ok: string; wrong: string; slow: string; broken: string }> = {
  c: {
    ok: '#include <stdio.h>\nint main(void){long long n;scanf("%lld",&n);printf("%lld\\n",n*(n+1)/2);return 0;}\n',
    wrong: '#include <stdio.h>\nint main(void){int n;scanf("%d",&n);printf("%d\\n",n*(n+1)/2);return 0;}\n',
    slow: "int main(void){volatile unsigned long i=0;for(;;)i++;}\n",
    broken: "int main(void){ return }\n",
  },
  cpp: {
    ok: "#include <bits/stdc++.h>\nint main(){long long n;std::cin>>n;std::cout<<n*(n+1)/2<<\"\\n\";}\n",
    wrong: "#include <bits/stdc++.h>\nint main(){int n;std::cin>>n;std::cout<<n*(n+1)/2<<\"\\n\";}\n",
    slow: "int main(){volatile unsigned long i=0;for(;;)i++;}\n",
    broken: "int main(){ std::cout << }\n",
  },
  java: {
    ok: "import java.util.*;\npublic class Main{public static void main(String[] a){long n=new Scanner(System.in).nextLong();System.out.println(n*(n+1)/2);}}\n",
    wrong: "import java.util.*;\npublic class Main{public static void main(String[] a){int n=new Scanner(System.in).nextInt();System.out.println(n*(n+1)/2);}}\n",
    slow: "public class Main{public static void main(String[] a){long i=0;while(true){i++;}}}\n",
    broken: "public class Main{ void }\n",
  },
  python: {
    ok: "n = int(input())\nprint(n * (n + 1) // 2)\n",
    wrong: "n = int(input())\nprint(n * n)\n",
    slow: "while True:\n    pass\n",
    broken: "def main(:\n",
  },
};

const TESTS = [
  { id: null, input: "5\n", expectedOutput: "15\n", isSample: true, weight: 1 },
  { id: null, input: "1000000\n", expectedOutput: "500000500000\n", isSample: false, weight: 1 },
];

const EXPECT: Record<keyof (typeof PROGRAMS)["c"], Verdict> = {
  ok: "accepted",
  wrong: "wrong_answer",
  slow: "time_limit_exceeded",
  broken: "compile_error",
};

const engine = engineFromEnv();
const limit = createLimiter(4);
console.log(`engine=${process.env.ENGINE ?? "judge0"} mode=${engine.executeBatch ? "compile-once batches" : "one job per test"}\n`);
let failures = 0;
for (const [language, programs] of Object.entries(PROGRAMS) as Array<[LanguageId, (typeof PROGRAMS)["c"]]>) {
  for (const [name, source] of Object.entries(programs) as Array<[keyof typeof EXPECT, string]>) {
    const started = performance.now();
    const outcome = await grade(engine, limit, { language, source, timeLimitMs: 1000, memoryLimitKb: 262144, tests: TESTS }).catch(
      (error: Error) => ({ verdict: `error: ${error.message}` as Verdict }),
    );
    // Python's broken program fails at runtime, not compile time.
    const want = language === "python" && name === "broken" ? "runtime_error" : EXPECT[name];
    const ok = outcome.verdict === want;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${language.padEnd(6)} ${name.padEnd(6)} → ${outcome.verdict}${ok ? "" : ` (expected ${want})`}  ${Math.round(performance.now() - started)}ms`);
  }
}
console.log(failures === 0 ? "\nEngine OK" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
