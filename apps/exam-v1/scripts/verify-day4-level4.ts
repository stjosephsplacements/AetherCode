import { engineFromEnv } from "../lib/engine.ts";
import { sql } from "../lib/db.ts";
import { normalizeOutput } from "../lib/compare.ts";

const SOLUTIONS: Record<string, string> = {
  "Minimum Path Sum": `
import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int R = sc.nextInt(), C = sc.nextInt();
        int[][] dp = new int[R][C];
        for (int i = 0; i < R; i++)
            for (int j = 0; j < C; j++) dp[i][j] = sc.nextInt();
        for (int j = 1; j < C; j++) dp[0][j] += dp[0][j-1];
        for (int i = 1; i < R; i++) dp[i][0] += dp[i-1][0];
        for (int i = 1; i < R; i++)
            for (int j = 1; j < C; j++)
                dp[i][j] += Math.min(dp[i-1][j], dp[i][j-1]);
        System.out.println(dp[R-1][C-1]);
    }
}`,

  "Unique Paths with Obstacles": `
import java.util.Scanner;
import java.math.BigInteger;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int R = sc.nextInt(), C = sc.nextInt();
        int[][] grid = new int[R][C];
        for (int i = 0; i < R; i++)
            for (int j = 0; j < C; j++) grid[i][j] = sc.nextInt();
        if (grid[0][0] == 1 || grid[R-1][C-1] == 1) { System.out.println(0); return; }
        BigInteger[][] dp = new BigInteger[R][C];
        for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) dp[i][j] = BigInteger.ZERO;
        dp[0][0] = BigInteger.ONE;
        for (int j = 1; j < C; j++) dp[0][j] = grid[0][j] == 1 ? BigInteger.ZERO : dp[0][j-1];
        for (int i = 1; i < R; i++) dp[i][0] = grid[i][0] == 1 ? BigInteger.ZERO : dp[i-1][0];
        for (int i = 1; i < R; i++)
            for (int j = 1; j < C; j++)
                dp[i][j] = grid[i][j] == 1 ? BigInteger.ZERO : dp[i-1][j].add(dp[i][j-1]);
        System.out.println(dp[R-1][C-1]);
    }
}`,

  "Maximal Square": `
import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int R = sc.nextInt(), C = sc.nextInt();
        int[][] dp = new int[R][C];
        int mx = 0;
        for (int i = 0; i < R; i++)
            for (int j = 0; j < C; j++) {
                dp[i][j] = sc.nextInt();
                if (dp[i][j] == 1 && i > 0 && j > 0)
                    dp[i][j] = Math.min(Math.min(dp[i-1][j], dp[i][j-1]), dp[i-1][j-1]) + 1;
                mx = Math.max(mx, dp[i][j]);
            }
        System.out.println(mx * mx);
    }
}`,

  "Dungeon Game": `
import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int R = sc.nextInt(), C = sc.nextInt();
        int[][] g = new int[R][C];
        for (int i = 0; i < R; i++)
            for (int j = 0; j < C; j++) g[i][j] = sc.nextInt();
        int[][] dp = new int[R][C];
        dp[R-1][C-1] = Math.max(1 - g[R-1][C-1], 1);
        for (int j = C-2; j >= 0; j--) dp[R-1][j] = Math.max(dp[R-1][j+1] - g[R-1][j], 1);
        for (int i = R-2; i >= 0; i--) dp[i][C-1] = Math.max(dp[i+1][C-1] - g[i][C-1], 1);
        for (int i = R-2; i >= 0; i--)
            for (int j = C-2; j >= 0; j--)
                dp[i][j] = Math.max(Math.min(dp[i+1][j], dp[i][j+1]) - g[i][j], 1);
        System.out.println(dp[0][0]);
    }
}`,

  "Gold Collection": `
import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int R = sc.nextInt(), C = sc.nextInt();
        int[][] dp = new int[R][C];
        for (int i = 0; i < R; i++)
            for (int j = 0; j < C; j++) dp[i][j] = sc.nextInt();
        for (int j = 1; j < C; j++)
            for (int i = 0; i < R; i++) {
                int best = dp[i][j-1];
                if (i > 0) best = Math.max(best, dp[i-1][j-1]);
                if (i < R-1) best = Math.max(best, dp[i+1][j-1]);
                dp[i][j] += best;
            }
        int ans = 0;
        for (int i = 0; i < R; i++) ans = Math.max(ans, dp[i][C-1]);
        System.out.println(ans);
    }
}`,
};

async function main() {
  const engine = engineFromEnv();

  const questions = await sql<{ id: string; title: string }[]>`
    SELECT q.id, q.title FROM questions q
    JOIN exam_questions eq ON eq.question_id = q.id
    WHERE eq.exam_id = 'a1292a8f-51bb-45d1-82ac-90ba66dada49'
    ORDER BY eq.ord`;

  let totalPass = 0, totalFail = 0;

  for (const q of questions) {
    const solution = SOLUTIONS[q.title];
    if (!solution) { console.log(`  SKIP: No solution for "${q.title}"`); continue; }

    const tcs = await sql<{ input: string; expected_output: string; is_sample: boolean; ord: number }[]>`
      SELECT input, expected_output, is_sample, ord FROM test_cases WHERE question_id = ${q.id} ORDER BY ord`;

    console.log(`\nVerifying "${q.title}" (${tcs.length} TCs)...`);

    const result = await engine.executeBatch!({
      language: "java",
      source: solution,
      inputs: tcs.map((tc) => tc.input),
      timeLimitMs: 5000,
      memoryLimitKb: 524288,
    });

    if ("compileError" in result) {
      console.log(`  COMPILE ERROR: ${result.compileError.slice(0, 200)}`);
      totalFail += tcs.length;
      continue;
    }

    let pass = 0, fail = 0;
    for (let i = 0; i < tcs.length; i++) {
      const expected = normalizeOutput(tcs[i].expected_output);
      const actual = normalizeOutput(result.results[i].stdout);
      if (actual === expected) {
        pass++;
      } else {
        fail++;
        console.log(`  FAIL TC${tcs[i].ord}: expected "${expected.slice(0, 50)}" got "${actual.slice(0, 50)}" [${result.results[i].status}]`);
      }
    }
    console.log(`  ✓ ${pass}/${tcs.length} passed${fail > 0 ? `, ${fail} FAILED` : ""}`);
    totalPass += pass;
    totalFail += fail;
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(`TOTAL: ${totalPass}/${totalPass + totalFail} passed${totalFail > 0 ? ` — ${totalFail} FAILED` : " — ALL PASS ✓"}`);

  await sql.end();
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
