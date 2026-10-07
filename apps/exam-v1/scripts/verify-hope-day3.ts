/**
 * Verify all HOPE Day 3 test cases by running Java reference solutions
 * through the AetherCode execution engine and comparing outputs.
 */
import { sql } from "../lib/db.ts";

const ENGINE_URL = process.env.ENGINE_URL ?? "http://172.17.0.1:5100";

interface TestCase {
  id: string;
  ord: number;
  input: string;
  expected_output: string;
  is_sample: boolean;
}

interface Question {
  id: string;
  title: string;
  exam_title: string;
  time_limit_ms: number;
  memory_limit_kb: number;
  test_cases: TestCase[];
}

// ─── Java reference solutions for all 25 questions ──────────────────────────

const SOLUTIONS: Record<string, string> = {

// ══════════════════════════════════════════════════════════════════════════════
// LEVEL 1: Frequency & Reorganization
// ══════════════════════════════════════════════════════════════════════════════

"Top K Frequent Elements": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(), k = sc.nextInt();
        Map<Integer,Integer> freq = new HashMap<>();
        for (int i = 0; i < n; i++) { int x = sc.nextInt(); freq.merge(x, 1, Integer::sum); }
        List<Map.Entry<Integer,Integer>> list = new ArrayList<>(freq.entrySet());
        list.sort((a,b) -> b.getValue() != a.getValue() ? b.getValue() - a.getValue() : a.getKey() - b.getKey());
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < k; i++) { if (i > 0) sb.append(' '); sb.append(list.get(i).getKey()); }
        System.out.println(sb);
    }
}`,

"Frequency Sort": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        Map<Integer,Integer> freq = new HashMap<>();
        for (int i = 0; i < n; i++) { a[i] = sc.nextInt(); freq.merge(a[i], 1, Integer::sum); }
        Integer[] arr = new Integer[n];
        for (int i = 0; i < n; i++) arr[i] = a[i];
        Arrays.sort(arr, (x,y) -> freq.get(x) != freq.get(y) ? freq.get(y) - freq.get(x) : x - y);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) { if (i > 0) sb.append(' '); sb.append(arr[i]); }
        System.out.println(sb);
    }
}`,

"Unique Frequency Check": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        Map<Integer,Integer> freq = new HashMap<>();
        for (int i = 0; i < n; i++) { int x = sc.nextInt(); freq.merge(x, 1, Integer::sum); }
        Set<Integer> seen = new HashSet<>(freq.values());
        System.out.println(seen.size() == freq.size() ? "YES" : "NO");
    }
}`,

"Reorganize String": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String s = sc.next();
        int[] freq = new int[26];
        for (char c : s.toCharArray()) freq[c - 'a']++;
        PriorityQueue<int[]> pq = new PriorityQueue<>((a,b) -> b[1] != a[1] ? b[1] - a[1] : a[0] - b[0]);
        for (int i = 0; i < 26; i++) if (freq[i] > 0) pq.offer(new int[]{i, freq[i]});
        StringBuilder sb = new StringBuilder();
        while (!pq.isEmpty()) {
            int[] first = pq.poll();
            if (sb.length() > 0 && sb.charAt(sb.length()-1) == (char)(first[0]+'a')) {
                if (pq.isEmpty()) { System.out.println("IMPOSSIBLE"); return; }
                int[] second = pq.poll();
                sb.append((char)(second[0]+'a'));
                second[1]--;
                if (second[1] > 0) pq.offer(second);
                pq.offer(first);
            } else {
                sb.append((char)(first[0]+'a'));
                first[1]--;
                if (first[1] > 0) pq.offer(first);
            }
        }
        System.out.println(sb);
    }
}`,

"Task Scheduler": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] freq = new int[26];
        for (int i = 0; i < n; i++) { String t = sc.next(); freq[t.charAt(0) - 'A']++; }
        int cool = sc.nextInt();
        int maxF = 0, countMax = 0;
        for (int f : freq) { if (f > maxF) { maxF = f; countMax = 1; } else if (f == maxF) countMax++; }
        System.out.println(Math.max(n, (maxF - 1) * (cool + 1) + countMax));
    }
}`,

// ══════════════════════════════════════════════════════════════════════════════
// LEVEL 2: Shortest Paths
// ══════════════════════════════════════════════════════════════════════════════

"Rotting Oranges": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int R = sc.nextInt(), C = sc.nextInt();
        int[][] grid = new int[R][C];
        Queue<int[]> q = new LinkedList<>();
        int fresh = 0;
        for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) {
            grid[i][j] = sc.nextInt();
            if (grid[i][j] == 2) q.offer(new int[]{i,j});
            else if (grid[i][j] == 1) fresh++;
        }
        if (fresh == 0) { System.out.println(0); return; }
        int[][] dirs = {{0,1},{0,-1},{1,0},{-1,0}};
        int minutes = 0;
        while (!q.isEmpty()) {
            int size = q.size();
            boolean rotted = false;
            for (int s = 0; s < size; s++) {
                int[] cell = q.poll();
                for (int[] d : dirs) {
                    int nr = cell[0]+d[0], nc = cell[1]+d[1];
                    if (nr >= 0 && nr < R && nc >= 0 && nc < C && grid[nr][nc] == 1) {
                        grid[nr][nc] = 2; fresh--; rotted = true;
                        q.offer(new int[]{nr,nc});
                    }
                }
            }
            if (rotted) minutes++;
        }
        System.out.println(fresh == 0 ? minutes : -1);
    }
}`,

"Shortest Path in Binary Matrix": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[][] grid = new int[n][n];
        for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) grid[i][j] = sc.nextInt();
        if (grid[0][0] == 1 || grid[n-1][n-1] == 1) { System.out.println(-1); return; }
        if (n == 1) { System.out.println(1); return; }
        boolean[][] vis = new boolean[n][n];
        Queue<int[]> q = new LinkedList<>();
        q.offer(new int[]{0,0,1}); vis[0][0] = true;
        int[][] dirs = {{0,1},{0,-1},{1,0},{-1,0},{1,1},{1,-1},{-1,1},{-1,-1}};
        while (!q.isEmpty()) {
            int[] c = q.poll();
            for (int[] d : dirs) {
                int nr = c[0]+d[0], nc = c[1]+d[1];
                if (nr >= 0 && nr < n && nc >= 0 && nc < n && !vis[nr][nc] && grid[nr][nc] == 0) {
                    if (nr == n-1 && nc == n-1) { System.out.println(c[2]+1); return; }
                    vis[nr][nc] = true; q.offer(new int[]{nr,nc,c[2]+1});
                }
            }
        }
        System.out.println(-1);
    }
}`,

"Network Delay Time": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt(), M = sc.nextInt(), K = sc.nextInt();
        List<List<int[]>> adj = new ArrayList<>();
        for (int i = 0; i <= N; i++) adj.add(new ArrayList<>());
        for (int i = 0; i < M; i++) { int u = sc.nextInt(), v = sc.nextInt(), w = sc.nextInt(); adj.get(u).add(new int[]{v,w}); }
        int[] dist = new int[N+1]; Arrays.fill(dist, Integer.MAX_VALUE); dist[K] = 0;
        PriorityQueue<int[]> pq = new PriorityQueue<>((a,b)->a[1]-b[1]);
        pq.offer(new int[]{K,0});
        while (!pq.isEmpty()) {
            int[] c = pq.poll();
            if (c[1] > dist[c[0]]) continue;
            for (int[] e : adj.get(c[0])) {
                int nd = c[1] + e[1];
                if (nd < dist[e[0]]) { dist[e[0]] = nd; pq.offer(new int[]{e[0],nd}); }
            }
        }
        int ans = 0;
        for (int i = 1; i <= N; i++) { if (dist[i] == Integer.MAX_VALUE) { System.out.println(-1); return; } ans = Math.max(ans, dist[i]); }
        System.out.println(ans);
    }
}`,

"Minimum Effort Path": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int R = sc.nextInt(), C = sc.nextInt();
        int[][] grid = new int[R][C];
        for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) grid[i][j] = sc.nextInt();
        if (R == 1 && C == 1) { System.out.println(0); return; }
        int[][] dist = new int[R][C];
        for (int[] row : dist) Arrays.fill(row, Integer.MAX_VALUE);
        dist[0][0] = 0;
        PriorityQueue<int[]> pq = new PriorityQueue<>((a,b)->a[2]-b[2]);
        pq.offer(new int[]{0,0,0});
        int[][] dirs = {{0,1},{0,-1},{1,0},{-1,0}};
        while (!pq.isEmpty()) {
            int[] c = pq.poll();
            if (c[2] > dist[c[0]][c[1]]) continue;
            if (c[0] == R-1 && c[1] == C-1) { System.out.println(c[2]); return; }
            for (int[] d : dirs) {
                int nr = c[0]+d[0], nc = c[1]+d[1];
                if (nr >= 0 && nr < R && nc >= 0 && nc < C) {
                    int effort = Math.max(c[2], Math.abs(grid[nr][nc] - grid[c[0]][c[1]]));
                    if (effort < dist[nr][nc]) { dist[nr][nc] = effort; pq.offer(new int[]{nr,nc,effort}); }
                }
            }
        }
        System.out.println(dist[R-1][C-1]);
    }
}`,

"Cheapest Flights Within K Stops": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int N = sc.nextInt(), M = sc.nextInt(), K = sc.nextInt(), src = sc.nextInt(), dst = sc.nextInt();
        int[] dist = new int[N]; Arrays.fill(dist, Integer.MAX_VALUE); dist[src] = 0;
        int[][] edges = new int[M][3];
        for (int i = 0; i < M; i++) { edges[i][0] = sc.nextInt(); edges[i][1] = sc.nextInt(); edges[i][2] = sc.nextInt(); }
        for (int i = 0; i <= K; i++) {
            int[] tmp = dist.clone();
            for (int[] e : edges) {
                if (dist[e[0]] != Integer.MAX_VALUE && dist[e[0]] + e[2] < tmp[e[1]]) {
                    tmp[e[1]] = dist[e[0]] + e[2];
                }
            }
            dist = tmp;
        }
        System.out.println(dist[dst] == Integer.MAX_VALUE ? -1 : dist[dst]);
    }
}`,

// ══════════════════════════════════════════════════════════════════════════════
// LEVEL 4: Knapsack & Partition DP
// ══════════════════════════════════════════════════════════════════════════════

"Partition Equal Subset Sum": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(); int[] a = new int[n];
        int sum = 0; for (int i = 0; i < n; i++) { a[i] = sc.nextInt(); sum += a[i]; }
        if (sum % 2 != 0) { System.out.println("NO"); return; }
        int target = sum / 2;
        boolean[] dp = new boolean[target+1]; dp[0] = true;
        for (int x : a) for (int j = target; j >= x; j--) dp[j] |= dp[j-x];
        System.out.println(dp[target] ? "YES" : "NO");
    }
}`,

"Target Sum": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(); int[] a = new int[n];
        int sum = 0; for (int i = 0; i < n; i++) { a[i] = sc.nextInt(); sum += a[i]; }
        int S = sc.nextInt();
        if ((sum + S) % 2 != 0 || sum + S < 0 || Math.abs(S) > sum) { System.out.println(0); return; }
        int target = (sum + S) / 2;
        int[] dp = new int[target+1]; dp[0] = 1;
        for (int x : a) for (int j = target; j >= x; j--) dp[j] += dp[j-x];
        System.out.println(dp[target]);
    }
}`,

"Ones and Zeroes": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int K = sc.nextInt(); String[] strs = new String[K];
        for (int i = 0; i < K; i++) strs[i] = sc.next();
        int m = sc.nextInt(), n = sc.nextInt();
        int[][] dp = new int[m+1][n+1];
        for (String s : strs) {
            int z = 0, o = 0;
            for (char c : s.toCharArray()) { if (c == '0') z++; else o++; }
            for (int i = m; i >= z; i--) for (int j = n; j >= o; j--)
                dp[i][j] = Math.max(dp[i][j], dp[i-z][j-o] + 1);
        }
        System.out.println(dp[m][n]);
    }
}`,

"Coin Change II": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int amount = sc.nextInt(), n = sc.nextInt();
        int[] coins = new int[n]; for (int i = 0; i < n; i++) coins[i] = sc.nextInt();
        long[] dp = new long[amount+1]; dp[0] = 1;
        for (int c : coins) for (int j = c; j <= amount; j++) dp[j] += dp[j-c];
        System.out.println(dp[amount]);
    }
}`,

"Last Stone Weight II": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(); int[] a = new int[n];
        int sum = 0; for (int i = 0; i < n; i++) { a[i] = sc.nextInt(); sum += a[i]; }
        int target = sum / 2;
        boolean[] dp = new boolean[target+1]; dp[0] = true;
        for (int x : a) for (int j = target; j >= x; j--) dp[j] |= dp[j-x];
        for (int j = target; j >= 0; j--) if (dp[j]) { System.out.println(sum - 2*j); return; }
    }
}`,

// ══════════════════════════════════════════════════════════════════════════════
// PRAVEEN'S BATCH: Advanced Algorithms
// ══════════════════════════════════════════════════════════════════════════════

"Pattern Matching (KMP)": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String T = sc.nextLine(), P = sc.nextLine();
        int n = T.length(), m = P.length();
        int[] lps = new int[m]; int len = 0, i = 1;
        while (i < m) {
            if (P.charAt(i) == P.charAt(len)) { lps[i++] = ++len; }
            else if (len > 0) len = lps[len-1];
            else lps[i++] = 0;
        }
        List<Integer> res = new ArrayList<>();
        int ti = 0, pi = 0;
        while (ti < n) {
            if (T.charAt(ti) == P.charAt(pi)) { ti++; pi++; }
            if (pi == m) { res.add(ti - m); pi = lps[pi-1]; }
            else if (ti < n && T.charAt(ti) != P.charAt(pi)) {
                if (pi > 0) pi = lps[pi-1]; else ti++;
            }
        }
        if (res.isEmpty()) System.out.println("NONE");
        else { StringBuilder sb = new StringBuilder(); for (int r = 0; r < res.size(); r++) { if (r > 0) sb.append(' '); sb.append(res.get(r)); } System.out.println(sb); }
    }
}`,

"Count Distinct Substrings": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String s = sc.next();
        int n = s.length();
        // Trie approach
        int[][] trie = new int[n * (n + 1) / 2 + 1][26];
        for (int[] row : trie) Arrays.fill(row, -1);
        int nodeCount = 1; // root is 0
        for (int i = 0; i < n; i++) {
            int cur = 0;
            for (int j = i; j < n; j++) {
                int c = s.charAt(j) - 'a';
                if (trie[cur][c] == -1) { trie[cur][c] = nodeCount++; }
                cur = trie[cur][c];
            }
        }
        System.out.println(nodeCount - 1); // exclude root
    }
}`,

"XOR Queries on Subarray": `
import java.util.*;
import java.io.*;
public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int n = Integer.parseInt(br.readLine().trim());
        StringTokenizer st = new StringTokenizer(br.readLine().trim());
        int[] prefix = new int[n+1];
        for (int i = 0; i < n; i++) prefix[i+1] = prefix[i] ^ Integer.parseInt(st.nextToken());
        int q = Integer.parseInt(br.readLine().trim());
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < q; i++) {
            st = new StringTokenizer(br.readLine().trim());
            int l = Integer.parseInt(st.nextToken()), r = Integer.parseInt(st.nextToken());
            sb.append(prefix[r+1] ^ prefix[l]).append('\\n');
        }
        System.out.print(sb);
    }
}`,

"Maximum XOR of Two Numbers": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt(); int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        int max = 0, mask = 0;
        for (int bit = 30; bit >= 0; bit--) {
            mask |= (1 << bit);
            int candidate = max | (1 << bit);
            Set<Integer> prefixes = new HashSet<>();
            for (int x : a) prefixes.add(x & mask);
            for (int p : prefixes) { if (prefixes.contains(candidate ^ p)) { max = candidate; break; } }
        }
        System.out.println(max);
    }
}`,

"Shortest String Period": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String s = sc.next();
        int n = s.length();
        int[] z = new int[n];
        int l = 0, r = 0;
        for (int i = 1; i < n; i++) {
            if (i < r) z[i] = Math.min(r - i, z[i - l]);
            while (i + z[i] < n && s.charAt(z[i]) == s.charAt(i + z[i])) z[i]++;
            if (i + z[i] > r) { l = i; r = i + z[i]; }
        }
        for (int p = 1; p <= n; p++) {
            if (p == n || (p + z[p] >= n)) { System.out.println(p); return; }
        }
    }
}`,

// ══════════════════════════════════════════════════════════════════════════════
// SELVA SIR: Linked List & Trees (Day 2)
// ══════════════════════════════════════════════════════════════════════════════

"Detect Cycle in Linked List": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] vals = new int[n]; for (int i = 0; i < n; i++) vals[i] = sc.nextInt();
        int pos = sc.nextInt();
        // Floyd's: simulate with array - if pos >= 0, there's a cycle
        System.out.println(pos >= 0 ? "YES" : "NO");
    }
}`,

"Palindrome Linked List": `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n]; for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        boolean ok = true;
        for (int i = 0; i < n/2; i++) if (a[i] != a[n-1-i]) { ok = false; break; }
        System.out.println(ok ? "YES" : "NO");
    }
}`,

"Binary Tree Maximum Path Sum": `
import java.util.*;
public class Main {
    static int[] tree;
    static int maxSum;
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        tree = new int[n]; for (int i = 0; i < n; i++) tree[i] = sc.nextInt();
        maxSum = Integer.MIN_VALUE;
        dfs(0);
        System.out.println(maxSum);
    }
    static int dfs(int i) {
        if (i >= tree.length || tree[i] == -1001) return 0;
        int left = Math.max(0, dfs(2*i+1));
        int right = Math.max(0, dfs(2*i+2));
        maxSum = Math.max(maxSum, tree[i] + left + right);
        return tree[i] + Math.max(left, right);
    }
}`,

"Validate Binary Search Tree": `
import java.util.*;
public class Main {
    static int[] tree;
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        tree = new int[n]; for (int i = 0; i < n; i++) tree[i] = sc.nextInt();
        System.out.println(valid(0, Long.MIN_VALUE, Long.MAX_VALUE) ? "YES" : "NO");
    }
    static boolean valid(int i, long lo, long hi) {
        if (i >= tree.length || tree[i] == -1001) return true;
        if (tree[i] <= lo || tree[i] >= hi) return false;
        return valid(2*i+1, lo, tree[i]) && valid(2*i+2, tree[i], hi);
    }
}`,

"Flatten Binary Tree to Pre-order": `
import java.util.*;
public class Main {
    static int[] tree;
    static StringBuilder sb = new StringBuilder();
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        tree = new int[n]; for (int i = 0; i < n; i++) tree[i] = sc.nextInt();
        preorder(0);
        System.out.println(sb.toString().trim());
    }
    static void preorder(int i) {
        if (i >= tree.length || tree[i] == -1001) return;
        if (sb.length() > 0) sb.append(' ');
        sb.append(tree[i]);
        preorder(2*i+1);
        preorder(2*i+2);
    }
}`,

};

// ─── Engine interaction ─────────────────────────────────────────────────────

async function runJava(source: string, input: string, timeLimitMs: number, memoryLimitKb: number): Promise<{ stdout: string; status: string }> {
  const created = await fetch(`${ENGINE_URL}/api/v1/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      language: "java",
      source_code: source,
      mode: "run",
      tests: [{ input, expected_output: "" }],
      time_limit_ms: Math.min(20000, timeLimitMs * 2),
      memory_limit_kb: Math.min(2097152, memoryLimitKb),
    }),
  });
  if (!created.ok) throw new Error(`engine ${created.status}: ${await created.text()}`);
  const { job_id } = (await created.json()) as { job_id: string };

  // SSE stream
  const stream = await fetch(`${ENGINE_URL}/api/v1/stream?job_id=${encodeURIComponent(job_id)}`, {
    headers: { accept: "text/event-stream" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!stream.ok || !stream.body) throw new Error(`stream ${stream.status}`);

  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", event = "", data: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (line === "") {
          if (event === "VERDICT" && data.length > 0) {
            const payload = JSON.parse(data.join("\n")) as { data: { verdict: string; compile_stderr?: string; results?: Array<{ stdout?: string; stdout_preview?: string; verdict: string }> } };
            if (payload.data.verdict === "compilation_error") return { stdout: "", status: "CE: " + (payload.data.compile_stderr ?? "") };
            const t = payload.data.results?.[0];
            return { stdout: (t?.stdout ?? t?.stdout_preview ?? "").trimEnd(), status: t?.verdict ?? payload.data.verdict };
          }
          event = ""; data = [];
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (done) return { stdout: "", status: "stream_ended" };
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

// ─── Main verification ──────────────────────────────────────────────────────

async function main() {
  // Fetch all Day 3 questions + test cases
  const rows = await sql<Array<{
    exam_title: string; question_id: string; question_title: string;
    time_limit_ms: number; memory_limit_kb: number; eq_ord: number;
    tc_id: string; tc_ord: number; tc_input: string; tc_expected: string; tc_sample: boolean;
  }>>`
    SELECT e.title AS exam_title, q.id AS question_id, q.title AS question_title,
           q.time_limit_ms, q.memory_limit_kb, eq.ord AS eq_ord,
           tc.id AS tc_id, tc.ord AS tc_ord, tc.input AS tc_input,
           tc.expected_output AS tc_expected, tc.is_sample AS tc_sample
    FROM exams e
    JOIN exam_questions eq ON eq.exam_id = e.id
    JOIN questions q ON q.id = eq.question_id
    JOIN test_cases tc ON tc.question_id = q.id
    WHERE e.title LIKE 'HOPE Day 3%'
    ORDER BY e.title, eq.ord, tc.ord
  `;

  // Group by question
  const questions = new Map<string, Question>();
  for (const r of rows) {
    if (!questions.has(r.question_id)) {
      questions.set(r.question_id, {
        id: r.question_id, title: r.question_title, exam_title: r.exam_title,
        time_limit_ms: r.time_limit_ms, memory_limit_kb: r.memory_limit_kb, test_cases: [],
      });
    }
    questions.get(r.question_id)!.test_cases.push({
      id: r.tc_id, ord: r.tc_ord, input: r.tc_input,
      expected_output: r.tc_expected, is_sample: r.tc_sample,
    });
  }

  let totalPass = 0, totalFail = 0, totalSkip = 0;
  const failures: string[] = [];

  for (const [, q] of questions) {
    const solution = SOLUTIONS[q.title];
    if (!solution) {
      console.log(`  SKIP "${q.title}" — no reference solution`);
      totalSkip += q.test_cases.length;
      continue;
    }

    process.stdout.write(`  Testing "${q.title}" (${q.test_cases.length} cases)...`);
    let pass = 0, fail = 0;

    for (const tc of q.test_cases) {
      try {
        const result = await runJava(solution, tc.input, q.time_limit_ms, q.memory_limit_kb);
        const expected = tc.expected_output.trimEnd();
        const actual = result.stdout.trimEnd();
        if (actual === expected) {
          pass++;
        } else {
          fail++;
          failures.push(`  FAIL ${q.title} tc#${tc.ord} (${tc.is_sample ? "sample" : "hidden"}): expected="${expected.slice(0,80)}" got="${actual.slice(0,80)}" status=${result.status}`);
        }
      } catch (err: any) {
        fail++;
        failures.push(`  ERROR ${q.title} tc#${tc.ord}: ${err.message}`);
      }
    }
    console.log(` ${pass}/${q.test_cases.length} passed` + (fail > 0 ? ` (${fail} FAILED)` : ""));
    totalPass += pass;
    totalFail += fail;
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Total: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped out of ${totalPass + totalFail + totalSkip}`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(f);
  }

  await sql.end();
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
