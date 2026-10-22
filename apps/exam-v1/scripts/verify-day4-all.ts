/**
 * Verify all HOPE Day 4 questions by running Java model solutions against the engine.
 * Tests each question's sample test cases (2 per question) to catch obviously wrong TCs.
 */
import { sql } from "../lib/db.ts";
import { engineFromEnv } from "../lib/engine.ts";

const SOLUTIONS: Record<string, string> = {
  // ── Level 1: Greedy ──
  "Jump Game": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt();
    int[] a = new int[n];
    for (int i = 0; i < n; i++) a[i] = sc.nextInt();
    int reach = 0;
    for (int i = 0; i <= reach && i < n; i++) reach = Math.max(reach, i + a[i]);
    System.out.println(reach >= n - 1 ? "YES" : "NO");
  }
}`,
  "Minimum Platforms": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt();
    int[] arr = new int[n], dep = new int[n];
    for (int i = 0; i < n; i++) arr[i] = sc.nextInt();
    for (int i = 0; i < n; i++) dep[i] = sc.nextInt();
    Arrays.sort(arr); Arrays.sort(dep);
    int plat = 0, max = 0, i = 0, j = 0;
    while (i < n) {
      if (arr[i] <= dep[j]) { plat++; i++; } else { plat--; j++; }
      max = Math.max(max, plat);
    }
    System.out.println(max);
  }
}`,
  "Partition Labels": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    String s = sc.next();
    int[] last = new int[26];
    for (int i = 0; i < s.length(); i++) last[s.charAt(i) - 'a'] = i;
    List<Integer> res = new ArrayList<>();
    int end = 0, start = 0;
    for (int i = 0; i < s.length(); i++) {
      end = Math.max(end, last[s.charAt(i) - 'a']);
      if (i == end) { res.add(end - start + 1); start = i + 1; }
    }
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < res.size(); i++) { if (i > 0) sb.append(' '); sb.append(res.get(i)); }
    System.out.println(sb);
  }
}`,
  "Gas Station Circuit": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt();
    int[] gas = new int[n], cost = new int[n];
    for (int i = 0; i < n; i++) gas[i] = sc.nextInt();
    for (int i = 0; i < n; i++) cost[i] = sc.nextInt();
    int total = 0, tank = 0, start = 0;
    for (int i = 0; i < n; i++) {
      int diff = gas[i] - cost[i];
      total += diff; tank += diff;
      if (tank < 0) { start = i + 1; tank = 0; }
    }
    System.out.println(total >= 0 ? start : -1);
  }
}`,
  "Largest Number": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt();
    String[] s = new String[n];
    for (int i = 0; i < n; i++) s[i] = String.valueOf(sc.nextInt());
    Arrays.sort(s, (a, b) -> (b + a).compareTo(a + b));
    if (s[0].equals("0")) { System.out.println("0"); return; }
    StringBuilder sb = new StringBuilder();
    for (String x : s) sb.append(x);
    System.out.println(sb);
  }
}`,

  // ── Level 2: Graph ──
  "Number of Islands": `import java.util.*;
public class Main {
  static int R, C;
  static char[][] g;
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    R = sc.nextInt(); C = sc.nextInt();
    g = new char[R][C];
    for (int i = 0; i < R; i++) { String row = sc.next(); for (int j = 0; j < C; j++) g[i][j] = row.charAt(j); }
    int count = 0;
    for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) if (g[i][j] == '1') { dfs(i, j); count++; }
    System.out.println(count);
  }
  static void dfs(int r, int c) {
    if (r < 0 || r >= R || c < 0 || c >= C || g[r][c] != '1') return;
    g[r][c] = '0';
    dfs(r+1,c); dfs(r-1,c); dfs(r,c+1); dfs(r,c-1);
  }
}`,
  "Course Schedule": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt(), m = sc.nextInt();
    List<List<Integer>> adj = new ArrayList<>();
    int[] deg = new int[n];
    for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
    for (int i = 0; i < m; i++) { int a = sc.nextInt(), b = sc.nextInt(); adj.get(b).add(a); deg[a]++; }
    Queue<Integer> q = new LinkedList<>();
    for (int i = 0; i < n; i++) if (deg[i] == 0) q.add(i);
    int done = 0;
    while (!q.isEmpty()) { int u = q.poll(); done++; for (int v : adj.get(u)) if (--deg[v] == 0) q.add(v); }
    System.out.println(done == n ? "YES" : "NO");
  }
}`,
  "Bipartite Check": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt(), m = sc.nextInt();
    List<List<Integer>> adj = new ArrayList<>();
    for (int i = 0; i <= n; i++) adj.add(new ArrayList<>());
    for (int i = 0; i < m; i++) { int u = sc.nextInt(), v = sc.nextInt(); adj.get(u).add(v); adj.get(v).add(u); }
    int[] color = new int[n + 1]; Arrays.fill(color, -1);
    boolean ok = true;
    for (int i = 1; i <= n && ok; i++) {
      if (color[i] != -1) continue;
      Queue<Integer> q = new LinkedList<>(); q.add(i); color[i] = 0;
      while (!q.isEmpty() && ok) {
        int u = q.poll();
        for (int v : adj.get(u)) { if (color[v] == -1) { color[v] = 1 - color[u]; q.add(v); } else if (color[v] == color[u]) ok = false; }
      }
    }
    System.out.println(ok ? "YES" : "NO");
  }
}`,
  "Shortest Path in Unweighted Graph": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt(), m = sc.nextInt(), s = sc.nextInt(), t = sc.nextInt();
    List<List<Integer>> adj = new ArrayList<>();
    for (int i = 0; i <= n; i++) adj.add(new ArrayList<>());
    for (int i = 0; i < m; i++) { int u = sc.nextInt(), v = sc.nextInt(); adj.get(u).add(v); adj.get(v).add(u); }
    int[] dist = new int[n + 1]; Arrays.fill(dist, -1); dist[s] = 0;
    Queue<Integer> q = new LinkedList<>(); q.add(s);
    while (!q.isEmpty()) { int u = q.poll(); for (int v : adj.get(u)) if (dist[v] == -1) { dist[v] = dist[u] + 1; q.add(v); } }
    System.out.println(dist[t]);
  }
}`,
  "Number of Provinces": `import java.util.*;
public class Main {
  static int[] parent, rank_;
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt();
    parent = new int[n]; rank_ = new int[n];
    for (int i = 0; i < n; i++) parent[i] = i;
    for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) { int v = sc.nextInt(); if (v == 1) union(i, j); }
    Set<Integer> roots = new HashSet<>();
    for (int i = 0; i < n; i++) roots.add(find(i));
    System.out.println(roots.size());
  }
  static int find(int x) { return parent[x] == x ? x : (parent[x] = find(parent[x])); }
  static void union(int a, int b) { a = find(a); b = find(b); if (a == b) return; if (rank_[a] < rank_[b]) { int t = a; a = b; b = t; } parent[b] = a; if (rank_[a] == rank_[b]) rank_[a]++; }
}`,

  // ── Selva: SLL/BT/BST ──
  "Reverse Linked List in K-Groups": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt(), k = sc.nextInt();
    int[] a = new int[n];
    for (int i = 0; i < n; i++) a[i] = sc.nextInt();
    for (int i = 0; i + k <= n; i += k) { int l = i, r = i + k - 1; while (l < r) { int t = a[l]; a[l] = a[r]; a[r] = t; l++; r--; } }
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < n; i++) { if (i > 0) sb.append(' '); sb.append(a[i]); }
    System.out.println(sb);
  }
}`,
  "Merge K Sorted Lists": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int k = sc.nextInt();
    PriorityQueue<Integer> pq = new PriorityQueue<>();
    for (int i = 0; i < k; i++) { int len = sc.nextInt(); for (int j = 0; j < len; j++) pq.add(sc.nextInt()); }
    StringBuilder sb = new StringBuilder();
    boolean first = true;
    while (!pq.isEmpty()) { if (!first) sb.append(' '); sb.append(pq.poll()); first = false; }
    System.out.println(sb);
  }
}`,
  "Binary Tree Level Order Traversal": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt();
    int[] a = new int[n];
    for (int i = 0; i < n; i++) a[i] = sc.nextInt();
    if (n == 0 || a[0] == -1001) return;
    Queue<Integer> q = new LinkedList<>(); q.add(0);
    while (!q.isEmpty()) {
      int sz = q.size();
      StringBuilder sb = new StringBuilder();
      for (int i = 0; i < sz; i++) {
        int idx = q.poll();
        if (i > 0) sb.append(' ');
        sb.append(a[idx]);
        int l = 2 * idx + 1, r = 2 * idx + 2;
        if (l < n && a[l] != -1001) q.add(l);
        if (r < n && a[r] != -1001) q.add(r);
      }
      System.out.println(sb);
    }
  }
}`,
  "Lowest Common Ancestor in BST": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt();
    int[] a = new int[n];
    for (int i = 0; i < n; i++) a[i] = sc.nextInt();
    int p = sc.nextInt(), q = sc.nextInt();
    System.out.println(lca(a, 0, p, q));
  }
  static int lca(int[] a, int i, int p, int q) {
    if (i >= a.length || a[i] == -1001) return -1;
    int v = a[i];
    if (p < v && q < v) return lca(a, 2*i+1, p, q);
    if (p > v && q > v) return lca(a, 2*i+2, p, q);
    return v;
  }
}`,
  "Kth Smallest Element in BST": `import java.util.*;
public class Main {
  static int count, result;
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt();
    int[] a = new int[n];
    for (int i = 0; i < n; i++) a[i] = sc.nextInt();
    int k = sc.nextInt();
    count = 0; result = 0;
    inorder(a, 0, k);
    System.out.println(result);
  }
  static void inorder(int[] a, int i, int k) {
    if (i >= a.length || a[i] == -1001) return;
    inorder(a, 2*i+1, k);
    count++;
    if (count == k) { result = a[i]; return; }
    inorder(a, 2*i+2, k);
  }
}`,

  // ── Praveen: Advanced ──
  "Prefix Count": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt(), q = sc.nextInt();
    String[] words = new String[n];
    for (int i = 0; i < n; i++) words[i] = sc.next();
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < q; i++) {
      String prefix = sc.next();
      int c = 0;
      for (String w : words) if (w.startsWith(prefix)) c++;
      if (i > 0) sb.append('\\n');
      sb.append(c);
    }
    System.out.println(sb);
  }
}`,
  "Single Number III": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt();
    int[] a = new int[n];
    for (int i = 0; i < n; i++) a[i] = sc.nextInt();
    int xor = 0;
    for (int x : a) xor ^= x;
    int bit = xor & (-xor);
    int g1 = 0, g2 = 0;
    for (int x : a) { if ((x & bit) != 0) g1 ^= x; else g2 ^= x; }
    if (g1 > g2) { int t = g1; g1 = g2; g2 = t; }
    System.out.println(g1 + " " + g2);
  }
}`,
  "Connected Components": `import java.util.*;
public class Main {
  static int[] parent, rank_;
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt(), m = sc.nextInt();
    parent = new int[n + 1]; rank_ = new int[n + 1];
    for (int i = 1; i <= n; i++) parent[i] = i;
    for (int i = 0; i < m; i++) { int u = sc.nextInt(), v = sc.nextInt(); union(u, v); }
    Set<Integer> roots = new HashSet<>();
    for (int i = 1; i <= n; i++) roots.add(find(i));
    System.out.println(roots.size());
  }
  static int find(int x) { return parent[x] == x ? x : (parent[x] = find(parent[x])); }
  static void union(int a, int b) { a = find(a); b = find(b); if (a == b) return; if (rank_[a] < rank_[b]) { int t = a; a = b; b = t; } parent[b] = a; if (rank_[a] == rank_[b]) rank_[a]++; }
}`,
  "Count Pattern Occurrences": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    String t = sc.next(), p = sc.next();
    int count = 0, idx = 0;
    while ((idx = t.indexOf(p, idx)) != -1) { count++; idx += p.length(); }
    System.out.println(count);
  }
}`,
  "Shortest Path with Negative Edges": `import java.util.*;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int n = sc.nextInt(), m = sc.nextInt();
    int[][] edges = new int[m][3];
    for (int i = 0; i < m; i++) { edges[i][0] = sc.nextInt(); edges[i][1] = sc.nextInt(); edges[i][2] = sc.nextInt(); }
    long[] dist = new long[n + 1]; Arrays.fill(dist, Long.MAX_VALUE); dist[1] = 0;
    for (int i = 0; i < n - 1; i++) for (int[] e : edges) if (dist[e[0]] != Long.MAX_VALUE && dist[e[0]] + e[2] < dist[e[1]]) dist[e[1]] = dist[e[0]] + e[2];
    // Check negative cycle reachable from 1 that can reach N
    boolean[] canRelax = new boolean[n + 1];
    for (int[] e : edges) if (dist[e[0]] != Long.MAX_VALUE && dist[e[0]] + e[2] < dist[e[1]]) canRelax[e[0]] = canRelax[e[1]] = true;
    // BFS from canRelax nodes to see if N is reachable
    List<List<Integer>> adj = new ArrayList<>(); for (int i = 0; i <= n; i++) adj.add(new ArrayList<>());
    for (int[] e : edges) adj.get(e[0]).add(e[1]);
    boolean[] visited = new boolean[n + 1];
    Queue<Integer> q = new LinkedList<>();
    for (int i = 1; i <= n; i++) if (canRelax[i]) { q.add(i); visited[i] = true; }
    while (!q.isEmpty()) { int u = q.poll(); for (int v : adj.get(u)) if (!visited[v]) { visited[v] = true; q.add(v); } }
    if (visited[n]) { System.out.println("NEGATIVE CYCLE"); return; }
    if (dist[n] == Long.MAX_VALUE) System.out.println("IMPOSSIBLE");
    else System.out.println(dist[n]);
  }
}`,
};

async function main() {
  const engine = engineFromEnv();
  let totalPass = 0, totalFail = 0;

  const questions = await sql<{ id: string; title: string; time_limit_ms: number; memory_limit_kb: number }[]>`
    SELECT q.id, q.title, q.time_limit_ms, q.memory_limit_kb
    FROM exams e JOIN exam_questions eq ON eq.exam_id = e.id JOIN questions q ON q.id = eq.question_id
    WHERE e.title LIKE 'HOPE Day 4%' ORDER BY e.title, eq.ord`;

  for (const q of questions) {
    const source = SOLUTIONS[q.title];
    if (!source) { console.log(`  SKIP ${q.title} — no solution`); continue; }

    const tcs = await sql<{ input: string; expected_output: string; is_sample: boolean; ord: number }[]>`
      SELECT input, expected_output, is_sample, ord FROM test_cases WHERE question_id = ${q.id} ORDER BY ord`;

    // Only test sample TCs for speed (2 per question = 50 total)
    const samples = tcs.filter(tc => tc.is_sample);
    let pass = 0, fail = 0;

    for (const tc of samples) {
      try {
        const result = await engine.execute({
          language: "java",
          source,
          stdin: tc.input,
          timeLimitMs: q.time_limit_ms,
          memoryLimitKb: q.memory_limit_kb,
        });
        const actual = result.stdout.trim();
        const expected = tc.expected_output.trim();
        if (result.status === "ok" && actual === expected) {
          pass++;
        } else {
          fail++;
          console.log(`  FAIL ${q.title} TC#${tc.ord}: status=${result.status} expected="${expected}" got="${actual}"`);
          if (result.stderr) console.log(`    stderr: ${result.stderr.slice(0, 200)}`);
        }
      } catch (err) {
        fail++;
        console.log(`  ERROR ${q.title} TC#${tc.ord}: ${err}`);
      }
    }

    const icon = fail === 0 ? "✓" : "✗";
    console.log(`${icon} ${q.title}: ${pass}/${samples.length} samples pass`);
    totalPass += pass;
    totalFail += fail;
  }

  console.log(`\n${totalFail === 0 ? "✓" : "✗"} Total: ${totalPass} pass, ${totalFail} fail out of ${totalPass + totalFail} sample tests`);
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
