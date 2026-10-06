/**
 * Validates all HOPE Assessment questions against every test case
 * across all 4 languages using the AetherCode engine.
 *
 * Usage:
 *   DATABASE_URL=postgres://... ENGINE_URL=http://172.17.0.1:5100 pnpm tsx scripts/test-all-questions.ts
 */

import postgres from "postgres";
import { AetherCodeEngine } from "../lib/engine.ts";
import { normalizeOutput } from "../lib/compare.ts";
import type { BatchExecResult } from "../lib/engine.ts";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL required");
const ENGINE_URL = process.env.ENGINE_URL ?? "http://172.17.0.1:5100";

const db = postgres(DB_URL, { max: 3 });
const engine = new AetherCodeEngine(ENGINE_URL);

// ─── Reference solutions ─────────────────────────────────────────────────────
// Keys must match the `title` column in the `questions` table exactly.

const SOLUTIONS: Record<string, Record<"python" | "c" | "cpp" | "java", string>> = {

  // ── HOPE Assessment — Level 1 ─────────────────────────────────────────────

  "Can You Reach the End?": {
    python: `
n = int(input())
a = list(map(int, input().split()))
reach = 0
for i in range(n):
    if i > reach:
        break
    if i + a[i] > reach:
        reach = i + a[i]
print("YES" if reach >= n - 1 else "NO")
`.trim(),
    c: `
#include <stdio.h>
int main(void) {
    int n; scanf("%d", &n);
    int a[100005];
    for (int i = 0; i < n; i++) scanf("%d", &a[i]);
    int reach = 0;
    for (int i = 0; i < n; i++) {
        if (i > reach) break;
        if (i + a[i] > reach) reach = i + a[i];
    }
    printf("%s\\n", reach >= n - 1 ? "YES" : "NO");
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<int> a(n);
    for (auto& x : a) cin >> x;
    int reach = 0;
    for (int i = 0; i < n; i++) {
        if (i > reach) break;
        reach = max(reach, i + a[i]);
    }
    cout << (reach >= n - 1 ? "YES" : "NO") << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = in.nextInt();
        int reach = 0;
        for (int i = 0; i < n; i++) {
            if (i > reach) break;
            reach = Math.max(reach, i + a[i]);
        }
        System.out.println(reach >= n - 1 ? "YES" : "NO");
    }
}
`.trim(),
  },

  "Minimum Leaps": {
    python: `
n = int(input())
a = list(map(int, input().split()))
if n == 1:
    print(0)
else:
    jumps = cur_end = far = 0
    for i in range(n - 1):
        far = max(far, i + a[i])
        if i == cur_end:
            jumps += 1
            cur_end = far
    print(jumps)
`.trim(),
    c: `
#include <stdio.h>
int main(void) {
    int n; scanf("%d", &n);
    int a[100005];
    for (int i = 0; i < n; i++) scanf("%d", &a[i]);
    if (n == 1) { printf("0\\n"); return 0; }
    int jumps = 0, cur_end = 0, far = 0;
    for (int i = 0; i < n - 1; i++) {
        if (i + a[i] > far) far = i + a[i];
        if (i == cur_end) { jumps++; cur_end = far; }
    }
    printf("%d\\n", jumps);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<int> a(n);
    for (auto& x : a) cin >> x;
    if (n == 1) { cout << 0 << "\\n"; return 0; }
    int jumps = 0, cur_end = 0, far = 0;
    for (int i = 0; i < n - 1; i++) {
        far = max(far, i + a[i]);
        if (i == cur_end) { jumps++; cur_end = far; }
    }
    cout << jumps << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = in.nextInt();
        if (n == 1) { System.out.println(0); return; }
        int jumps = 0, curEnd = 0, far = 0;
        for (int i = 0; i < n - 1; i++) {
            far = Math.max(far, i + a[i]);
            if (i == curEnd) { jumps++; curEnd = far; }
        }
        System.out.println(jumps);
    }
}
`.trim(),
  },

  "Circular Fuel Route": {
    python: `
n = int(input())
fuel = list(map(int, input().split()))
cost = list(map(int, input().split()))
if sum(fuel) < sum(cost):
    print(-1)
else:
    start = 0
    tank = 0
    for i in range(n):
        tank += fuel[i] - cost[i]
        if tank < 0:
            start = i + 1
            tank = 0
    print(start)
`.trim(),
    c: `
#include <stdio.h>
int main(void) {
    int n; scanf("%d", &n);
    int fuel[100005], cost[100005];
    long long tf = 0, tc = 0;
    for (int i = 0; i < n; i++) { scanf("%d", &fuel[i]); tf += fuel[i]; }
    for (int i = 0; i < n; i++) { scanf("%d", &cost[i]); tc += cost[i]; }
    if (tf < tc) { printf("-1\\n"); return 0; }
    int start = 0; long long tank = 0;
    for (int i = 0; i < n; i++) {
        tank += fuel[i] - cost[i];
        if (tank < 0) { start = i + 1; tank = 0; }
    }
    printf("%d\\n", start);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<int> fuel(n), cost(n);
    for (auto& x : fuel) cin >> x;
    for (auto& x : cost) cin >> x;
    long long tf = 0, tc = 0;
    for (int x : fuel) tf += x;
    for (int x : cost) tc += x;
    if (tf < tc) { cout << -1 << "\\n"; return 0; }
    int start = 0; long long tank = 0;
    for (int i = 0; i < n; i++) {
        tank += fuel[i] - cost[i];
        if (tank < 0) { start = i + 1; tank = 0; }
    }
    cout << start << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        int[] fuel = new int[n], cost = new int[n];
        long tf = 0, tc = 0;
        for (int i = 0; i < n; i++) { fuel[i] = in.nextInt(); tf += fuel[i]; }
        for (int i = 0; i < n; i++) { cost[i] = in.nextInt(); tc += cost[i]; }
        if (tf < tc) { System.out.println(-1); return; }
        int start = 0; long tank = 0;
        for (int i = 0; i < n; i++) {
            tank += fuel[i] - cost[i];
            if (tank < 0) { start = i + 1; tank = 0; }
        }
        System.out.println(start);
    }
}
`.trim(),
  },

  "Balanced Segmentation": {
    python: `
s = input()
last = {}
for i, c in enumerate(s):
    last[c] = i
parts = []
start = end = 0
for i, c in enumerate(s):
    end = max(end, last[c])
    if i == end:
        parts.append(end - start + 1)
        start = i + 1
print(*parts)
`.trim(),
    c: `
#include <stdio.h>
#include <string.h>
int main(void) {
    char s[200005];
    scanf("%s", s);
    int n = (int)strlen(s);
    int last[26] = {0};
    for (int i = 0; i < n; i++) last[s[i]-'a'] = i;
    int start = 0, end = 0, first = 1;
    for (int i = 0; i < n; i++) {
        if (last[s[i]-'a'] > end) end = last[s[i]-'a'];
        if (i == end) {
            if (!first) printf(" ");
            printf("%d", end - start + 1);
            first = 0;
            start = i + 1;
        }
    }
    printf("\\n");
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    string s; cin >> s;
    int n = s.size();
    vector<int> last(26, 0);
    for (int i = 0; i < n; i++) last[s[i]-'a'] = i;
    int start = 0, end = 0;
    vector<int> parts;
    for (int i = 0; i < n; i++) {
        end = max(end, last[s[i]-'a']);
        if (i == end) { parts.push_back(end-start+1); start = i+1; }
    }
    for (int i = 0; i < (int)parts.size(); i++) cout << (i?" ":"") << parts[i];
    cout << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        String s = in.next();
        int n = s.length();
        int[] last = new int[26];
        for (int i = 0; i < n; i++) last[s.charAt(i)-'a'] = i;
        int start = 0, end = 0;
        List<Integer> parts = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            end = Math.max(end, last[s.charAt(i)-'a']);
            if (i == end) { parts.add(end-start+1); start = i+1; }
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.size(); i++) { if(i>0)sb.append(' '); sb.append(parts.get(i)); }
        System.out.println(sb);
    }
}
`.trim(),
  },

  "Peak Contiguous Sum": {
    python: `
n = int(input())
a = list(map(int, input().split()))
best = cur = a[0]
for i in range(1, n):
    cur = max(a[i], cur + a[i])
    best = max(best, cur)
print(best)
`.trim(),
    c: `
#include <stdio.h>
int main(void) {
    int n; scanf("%d", &n);
    long long a[100005];
    for (int i = 0; i < n; i++) scanf("%lld", &a[i]);
    long long best = a[0], cur = a[0];
    for (int i = 1; i < n; i++) {
        cur = a[i] > cur + a[i] ? a[i] : cur + a[i];
        if (cur > best) best = cur;
    }
    printf("%lld\\n", best);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<long long> a(n);
    for (auto& x : a) cin >> x;
    long long best = a[0], cur = a[0];
    for (int i = 1; i < n; i++) {
        cur = max(a[i], cur + a[i]);
        best = max(best, cur);
    }
    cout << best << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        long[] a = new long[n];
        for (int i = 0; i < n; i++) a[i] = in.nextLong();
        long best = a[0], cur = a[0];
        for (int i = 1; i < n; i++) {
            cur = Math.max(a[i], cur + a[i]);
            best = Math.max(best, cur);
        }
        System.out.println(best);
    }
}
`.trim(),
  },

  // ── HOPE Assessment — Level 2 ─────────────────────────────────────────────

  "Count the Islands": {
    python: `
import sys
from collections import deque
input = sys.stdin.readline
r, c = map(int, input().split())
grid = [list(input().strip()) for _ in range(r)]
vis = [[False]*c for _ in range(r)]
dx = [-1, 1, 0, 0]
dy = [0, 0, -1, 1]
count = 0
for i in range(r):
    for j in range(c):
        if grid[i][j] == '1' and not vis[i][j]:
            vis[i][j] = True
            q = deque([(i, j)])
            while q:
                x, y = q.popleft()
                for d in range(4):
                    nx, ny = x+dx[d], y+dy[d]
                    if 0<=nx<r and 0<=ny<c and not vis[nx][ny] and grid[nx][ny]=='1':
                        vis[nx][ny] = True
                        q.append((nx, ny))
            count += 1
print(count)
`.trim(),
    c: `
#include <stdio.h>
int R, C;
char grid[305][305];
int vis[305][305];
int qx[100000], qy[100000];
void bfs(int i, int j) {
    int head = 0, tail = 0;
    qx[tail] = i; qy[tail] = j; tail++;
    vis[i][j] = 1;
    int dx[] = {-1,1,0,0}, dy[] = {0,0,-1,1};
    while (head < tail) {
        int x = qx[head], y = qy[head]; head++;
        for (int d = 0; d < 4; d++) {
            int nx = x+dx[d], ny = y+dy[d];
            if (nx>=0&&nx<R&&ny>=0&&ny<C&&!vis[nx][ny]&&grid[nx][ny]=='1') {
                vis[nx][ny] = 1; qx[tail] = nx; qy[tail] = ny; tail++;
            }
        }
    }
}
int main(void) {
    scanf("%d %d", &R, &C);
    for (int i = 0; i < R; i++) scanf("%s", grid[i]);
    int count = 0;
    for (int i = 0; i < R; i++)
        for (int j = 0; j < C; j++)
            if (grid[i][j]=='1' && !vis[i][j]) { bfs(i,j); count++; }
    printf("%d\\n", count);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int R, C; cin >> R >> C;
    vector<string> g(R);
    for (auto& row : g) cin >> row;
    vector<vector<bool>> vis(R, vector<bool>(C, false));
    int dx[] = {-1,1,0,0}, dy[] = {0,0,-1,1};
    int cnt = 0;
    for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) {
        if (g[i][j]=='1' && !vis[i][j]) {
            cnt++;
            queue<pair<int,int>> q;
            q.push({i,j}); vis[i][j] = true;
            while (!q.empty()) {
                auto [x,y] = q.front(); q.pop();
                for (int d = 0; d < 4; d++) {
                    int nx=x+dx[d], ny=y+dy[d];
                    if (nx>=0&&nx<R&&ny>=0&&ny<C&&!vis[nx][ny]&&g[nx][ny]=='1')
                        { vis[nx][ny]=true; q.push({nx,ny}); }
                }
            }
        }
    }
    cout << cnt << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int R = in.nextInt(), C = in.nextInt();
        String[] g = new String[R];
        for (int i = 0; i < R; i++) g[i] = in.next();
        boolean[][] vis = new boolean[R][C];
        int[] dx = {-1,1,0,0}, dy = {0,0,-1,1};
        int cnt = 0;
        for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) {
            if (g[i].charAt(j)=='1' && !vis[i][j]) {
                cnt++;
                Queue<int[]> q = new ArrayDeque<>();
                q.add(new int[]{i,j}); vis[i][j] = true;
                while (!q.isEmpty()) {
                    int[] cur = q.poll();
                    for (int d = 0; d < 4; d++) {
                        int nx=cur[0]+dx[d], ny=cur[1]+dy[d];
                        if (nx>=0&&nx<R&&ny>=0&&ny<C&&!vis[nx][ny]&&g[nx].charAt(ny)=='1')
                            { vis[nx][ny]=true; q.add(new int[]{nx,ny}); }
                    }
                }
            }
        }
        System.out.println(cnt);
    }
}
`.trim(),
  },

  "Colour Spread": {
    python: `
import sys
from collections import deque
input = sys.stdin.readline
line1 = input().split()
r, c, new_color = int(line1[0]), int(line1[1]), line1[2]
sr, sc = map(int, input().split())
grid = [input().split() for _ in range(r)]
target = grid[sr][sc]
if target != new_color:
    q = deque([(sr, sc)])
    grid[sr][sc] = new_color
    while q:
        x, y = q.popleft()
        for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
            nx, ny = x+dx, y+dy
            if 0<=nx<r and 0<=ny<c and grid[nx][ny]==target:
                grid[nx][ny] = new_color
                q.append((nx, ny))
for row in grid:
    print(*row)
`.trim(),
    c: `
#include <stdio.h>
#include <string.h>
#define MAXR 305
#define MAXC 305
int R, C;
char grid[MAXR][MAXC][20];
char target[20], nc[20];
int qx[MAXR*MAXC], qy[MAXR*MAXC];
int dx[] = {-1,1,0,0}, dy[] = {0,0,-1,1};
int main(void) {
    scanf("%d %d %s", &R, &C, nc);
    int sr, sc; scanf("%d %d", &sr, &sc);
    for (int i = 0; i < R; i++)
        for (int j = 0; j < C; j++)
            scanf("%s", grid[i][j]);
    strcpy(target, grid[sr][sc]);
    if (strcmp(target, nc) != 0) {
        int head = 0, tail = 0;
        qx[tail] = sr; qy[tail] = sc; tail++;
        strcpy(grid[sr][sc], nc);
        while (head < tail) {
            int x = qx[head], y = qy[head]; head++;
            for (int d = 0; d < 4; d++) {
                int nx = x+dx[d], ny = y+dy[d];
                if (nx>=0&&nx<R&&ny>=0&&ny<C&&strcmp(grid[nx][ny],target)==0) {
                    strcpy(grid[nx][ny], nc);
                    qx[tail] = nx; qy[tail] = ny; tail++;
                }
            }
        }
    }
    for (int i = 0; i < R; i++) {
        for (int j = 0; j < C; j++) printf("%s%s", j?" ":"", grid[i][j]);
        printf("\\n");
    }
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int R, C; string nc; cin >> R >> C >> nc;
    int sr, sc; cin >> sr >> sc;
    vector<vector<string>> g(R, vector<string>(C));
    for (auto& row : g) for (auto& x : row) cin >> x;
    string target = g[sr][sc];
    if (target != nc) {
        queue<pair<int,int>> q;
        q.push({sr,sc}); g[sr][sc] = nc;
        int dx[] = {-1,1,0,0}, dy[] = {0,0,-1,1};
        while (!q.empty()) {
            auto [x,y] = q.front(); q.pop();
            for (int d = 0; d < 4; d++) {
                int nx=x+dx[d], ny=y+dy[d];
                if (nx>=0&&nx<R&&ny>=0&&ny<C&&g[nx][ny]==target)
                    { g[nx][ny]=nc; q.push({nx,ny}); }
            }
        }
    }
    for (auto& row : g) {
        for (int j = 0; j < C; j++) cout << (j?" ":"") << row[j];
        cout << "\\n";
    }
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int R = in.nextInt(), C = in.nextInt();
        String nc = in.next();
        int sr = in.nextInt(), sc = in.nextInt();
        String[][] g = new String[R][C];
        for (int i = 0; i < R; i++) for (int j = 0; j < C; j++) g[i][j] = in.next();
        String target = g[sr][sc];
        if (!target.equals(nc)) {
            Queue<int[]> q = new ArrayDeque<>();
            q.add(new int[]{sr,sc}); g[sr][sc] = nc;
            int[] dx={-1,1,0,0}, dy={0,0,-1,1};
            while (!q.isEmpty()) {
                int[] cur = q.poll();
                for (int d = 0; d < 4; d++) {
                    int nx=cur[0]+dx[d], ny=cur[1]+dy[d];
                    if (nx>=0&&nx<R&&ny>=0&&ny<C&&g[nx][ny].equals(target))
                        { g[nx][ny]=nc; q.add(new int[]{nx,ny}); }
                }
            }
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < R; i++) {
            for (int j = 0; j < C; j++) { if(j>0)sb.append(' '); sb.append(g[i][j]); }
            sb.append("\\n");
        }
        System.out.print(sb);
    }
}
`.trim(),
  },

  "Find the Path": {
    python: `
from collections import deque
n, m, src, dst = map(int, input().split())
adj = [[] for _ in range(n+1)]
for _ in range(m):
    u, v = map(int, input().split())
    adj[u].append(v)
    adj[v].append(u)
visited = [False]*(n+1)
visited[src] = True
q = deque([src])
while q:
    u = q.popleft()
    if u == dst: break
    for v in adj[u]:
        if not visited[v]:
            visited[v] = True
            q.append(v)
print("YES" if visited[dst] else "NO")
`.trim(),
    c: `
#include <stdio.h>
#include <string.h>
#define MAXN 100005
int head[MAXN], nxt[200005], to[200005], ecnt = 0;
int vis[MAXN];
int qbuf[MAXN];
void addedge(int u, int v) {
    to[++ecnt]=v; nxt[ecnt]=head[u]; head[u]=ecnt;
}
int main(void) {
    int n, m, src, dst;
    scanf("%d %d %d %d", &n, &m, &src, &dst);
    for (int i = 0; i < m; i++) {
        int u, v; scanf("%d %d", &u, &v);
        addedge(u,v); addedge(v,u);
    }
    int head2=0, tail=0;
    vis[src]=1; qbuf[tail++]=src;
    while (head2 < tail) {
        int u = qbuf[head2++];
        for (int e=head[u]; e; e=nxt[e]) {
            if (!vis[to[e]]) { vis[to[e]]=1; qbuf[tail++]=to[e]; }
        }
    }
    printf("%s\\n", vis[dst] ? "YES" : "NO");
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n, m, src, dst; cin >> n >> m >> src >> dst;
    vector<vector<int>> adj(n+1);
    for (int i = 0; i < m; i++) {
        int u, v; cin >> u >> v;
        adj[u].push_back(v); adj[v].push_back(u);
    }
    vector<bool> vis(n+1, false);
    queue<int> q;
    vis[src]=true; q.push(src);
    while (!q.empty()) {
        int u = q.front(); q.pop();
        for (int v : adj[u]) if (!vis[v]) { vis[v]=true; q.push(v); }
    }
    cout << (vis[dst] ? "YES" : "NO") << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n=in.nextInt(), m=in.nextInt(), src=in.nextInt(), dst=in.nextInt();
        @SuppressWarnings("unchecked")
        List<Integer>[] adj = new List[n+1];
        for (int i=1;i<=n;i++) adj[i]=new ArrayList<>();
        for (int i=0;i<m;i++) {
            int u=in.nextInt(), v=in.nextInt();
            adj[u].add(v); adj[v].add(u);
        }
        boolean[] vis=new boolean[n+1];
        Queue<Integer> q=new ArrayDeque<>();
        vis[src]=true; q.add(src);
        while (!q.isEmpty()) {
            int u=q.poll();
            for (int v:adj[u]) if (!vis[v]) { vis[v]=true; q.add(v); }
        }
        System.out.println(vis[dst] ? "YES" : "NO");
    }
}
`.trim(),
  },

  "Friendship Clusters": {
    python: `
n, m = map(int, input().split())
parent = list(range(n+1))
rank = [0]*(n+1)
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x
def union(a, b):
    a, b = find(a), find(b)
    if a == b: return
    if rank[a] < rank[b]: a, b = b, a
    parent[b] = a
    if rank[a] == rank[b]: rank[a] += 1
for _ in range(m):
    u, v = map(int, input().split())
    union(u, v)
print(len(set(find(i) for i in range(1, n+1))))
`.trim(),
    c: `
#include <stdio.h>
int parent[200005], rnk[200005];
int find(int x) { while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];} return x; }
void unite(int a, int b) {
    a=find(a); b=find(b); if(a==b)return;
    if(rnk[a]<rnk[b]){int t=a;a=b;b=t;}
    parent[b]=a; if(rnk[a]==rnk[b])rnk[a]++;
}
int main(void) {
    int n, m; scanf("%d %d", &n, &m);
    for (int i = 1; i <= n; i++) { parent[i]=i; rnk[i]=0; }
    for (int i = 0; i < m; i++) { int u,v; scanf("%d %d",&u,&v); unite(u,v); }
    int seen[200005] = {0}, cnt = 0;
    for (int i = 1; i <= n; i++) { int r=find(i); if(!seen[r]){seen[r]=1;cnt++;} }
    printf("%d\\n", cnt);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int parent[200005], rnk[200005];
int find(int x){while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
void unite(int a,int b){a=find(a);b=find(b);if(a==b)return;if(rnk[a]<rnk[b])swap(a,b);parent[b]=a;if(rnk[a]==rnk[b])rnk[a]++;}
int main(){
    int n,m; cin>>n>>m;
    for(int i=1;i<=n;i++){parent[i]=i;rnk[i]=0;}
    for(int i=0;i<m;i++){int u,v;cin>>u>>v;unite(u,v);}
    set<int> roots;
    for(int i=1;i<=n;i++) roots.insert(find(i));
    cout<<roots.size()<<"\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    static int[] parent, rank;
    static int find(int x){while(parent[x]!=x){parent[x]=parent[parent[x]];x=parent[x];}return x;}
    static void unite(int a,int b){a=find(a);b=find(b);if(a==b)return;if(rank[a]<rank[b]){int t=a;a=b;b=t;}parent[b]=a;if(rank[a]==rank[b])rank[a]++;}
    public static void main(String[] args){
        Scanner in=new Scanner(System.in);
        int n=in.nextInt(),m=in.nextInt();
        parent=new int[n+1]; rank=new int[n+1];
        for(int i=1;i<=n;i++) parent[i]=i;
        for(int i=0;i<m;i++){int u=in.nextInt(),v=in.nextInt();unite(u,v);}
        Set<Integer> roots=new HashSet<>();
        for(int i=1;i<=n;i++) roots.add(find(i));
        System.out.println(roots.size());
    }
}
`.trim(),
  },

  "Escape the Maze": {
    python: `
from collections import deque
import sys
input = sys.stdin.readline
r, c = map(int, input().split())
grid = [input().strip() for _ in range(r)]
dist = [[-1]*c for _ in range(r)]
dist[0][0] = 0
q = deque([(0,0)])
while q:
    x, y = q.popleft()
    for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
        nx, ny = x+dx, y+dy
        if 0<=nx<r and 0<=ny<c and dist[nx][ny]==-1 and grid[nx][ny]!='#':
            dist[nx][ny] = dist[x][y]+1
            q.append((nx,ny))
print(dist[r-1][c-1])
`.trim(),
    c: `
#include <stdio.h>
#include <string.h>
int R, C;
char grid[305][305];
int dist[305][305];
int qx[100000], qy[100000];
int main(void) {
    scanf("%d %d", &R, &C);
    for (int i = 0; i < R; i++) scanf("%s", grid[i]);
    memset(dist, -1, sizeof(dist));
    dist[0][0] = 0;
    int head=0, tail=0;
    qx[tail]=0; qy[tail]=0; tail++;
    int dx[]={-1,1,0,0}, dy[]={0,0,-1,1};
    while (head < tail) {
        int x=qx[head], y=qy[head]; head++;
        for (int d = 0; d < 4; d++) {
            int nx=x+dx[d], ny=y+dy[d];
            if (nx>=0&&nx<R&&ny>=0&&ny<C&&dist[nx][ny]==-1&&grid[nx][ny]!='#') {
                dist[nx][ny] = dist[x][y]+1;
                qx[tail]=nx; qy[tail]=ny; tail++;
            }
        }
    }
    printf("%d\\n", dist[R-1][C-1]);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int R, C; cin >> R >> C;
    vector<string> g(R);
    for (auto& row : g) cin >> row;
    vector<vector<int>> dist(R, vector<int>(C,-1));
    queue<pair<int,int>> q;
    dist[0][0]=0; q.push({0,0});
    int dx[]={-1,1,0,0}, dy[]={0,0,-1,1};
    while (!q.empty()) {
        auto [x,y]=q.front(); q.pop();
        for (int d=0;d<4;d++) {
            int nx=x+dx[d], ny=y+dy[d];
            if (nx>=0&&nx<R&&ny>=0&&ny<C&&dist[nx][ny]==-1&&g[nx][ny]!='#')
                { dist[nx][ny]=dist[x][y]+1; q.push({nx,ny}); }
        }
    }
    cout << dist[R-1][C-1] << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int R=in.nextInt(), C=in.nextInt();
        String[] g = new String[R];
        for (int i=0;i<R;i++) g[i]=in.next();
        int[][] dist=new int[R][C];
        for (int[] row:dist) Arrays.fill(row,-1);
        Queue<int[]> q=new ArrayDeque<>();
        dist[0][0]=0; q.add(new int[]{0,0});
        int[] dx={-1,1,0,0}, dy={0,0,-1,1};
        while (!q.isEmpty()) {
            int[] cur=q.poll();
            for (int d=0;d<4;d++) {
                int nx=cur[0]+dx[d], ny=cur[1]+dy[d];
                if (nx>=0&&nx<R&&ny>=0&&ny<C&&dist[nx][ny]==-1&&g[nx].charAt(ny)!='#')
                    { dist[nx][ny]=dist[cur[0]][cur[1]]+1; q.add(new int[]{nx,ny}); }
            }
        }
        System.out.println(dist[R-1][C-1]);
    }
}
`.trim(),
  },

  // ── HOPE Assessment — Level 4 ─────────────────────────────────────────────

  "Paths Through the Grid": {
    python: `
MOD = 10**9 + 7
m, n = map(int, input().split())
dp = [[1]*n for _ in range(m)]
for i in range(1, m):
    for j in range(1, n):
        dp[i][j] = (dp[i-1][j] + dp[i][j-1]) % MOD
print(dp[m-1][n-1])
`.trim(),
    c: `
#include <stdio.h>
#define MOD 1000000007LL
long long dp[105][105];
int main(void) {
    int m, n; scanf("%d %d", &m, &n);
    for (int i=0;i<m;i++) dp[i][0]=1;
    for (int j=0;j<n;j++) dp[0][j]=1;
    for (int i=1;i<m;i++) for (int j=1;j<n;j++) dp[i][j]=(dp[i-1][j]+dp[i][j-1])%MOD;
    printf("%lld\\n", dp[m-1][n-1]);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
const long long MOD = 1e9+7;
int main() {
    int m, n; cin >> m >> n;
    vector<vector<long long>> dp(m, vector<long long>(n, 1));
    for (int i=1;i<m;i++) for (int j=1;j<n;j++) dp[i][j]=(dp[i-1][j]+dp[i][j-1])%MOD;
    cout << dp[m-1][n-1] << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int m = in.nextInt(), n = in.nextInt();
        long MOD = 1_000_000_007L;
        long[][] dp = new long[m][n];
        for (int i=0;i<m;i++) dp[i][0]=1;
        for (int j=0;j<n;j++) dp[0][j]=1;
        for (int i=1;i<m;i++) for (int j=1;j<n;j++) dp[i][j]=(dp[i-1][j]+dp[i][j-1])%MOD;
        System.out.println(dp[m-1][n-1]);
    }
}
`.trim(),
  },

  "Paths Around the Obstacles": {
    python: `
MOD = 10**9 + 7
m, n = map(int, input().split())
grid = [list(map(int, input().split())) for _ in range(m)]
dp = [[0]*n for _ in range(m)]
for i in range(m):
    if grid[i][0] == 1: break
    dp[i][0] = 1
for j in range(n):
    if grid[0][j] == 1: break
    dp[0][j] = 1
for i in range(1, m):
    for j in range(1, n):
        if grid[i][j] == 0:
            dp[i][j] = (dp[i-1][j] + dp[i][j-1]) % MOD
print(dp[m-1][n-1])
`.trim(),
    c: `
#include <stdio.h>
#define MOD 1000000007LL
long long dp[105][105];
int grid[105][105];
int main(void) {
    int m, n; scanf("%d %d", &m, &n);
    for (int i=0;i<m;i++) for (int j=0;j<n;j++) scanf("%d", &grid[i][j]);
    for (int i=0;i<m;i++){if(grid[i][0])break; dp[i][0]=1;}
    for (int j=0;j<n;j++){if(grid[0][j])break; dp[0][j]=1;}
    for (int i=1;i<m;i++) for (int j=1;j<n;j++)
        if (!grid[i][j]) dp[i][j]=(dp[i-1][j]+dp[i][j-1])%MOD;
    printf("%lld\\n", dp[m-1][n-1]);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
const long long MOD = 1e9+7;
int main() {
    int m, n; cin >> m >> n;
    vector<vector<int>> g(m, vector<int>(n));
    for (auto& row:g) for (auto& x:row) cin>>x;
    vector<vector<long long>> dp(m, vector<long long>(n, 0));
    for (int i=0;i<m;i++){if(g[i][0])break; dp[i][0]=1;}
    for (int j=0;j<n;j++){if(g[0][j])break; dp[0][j]=1;}
    for (int i=1;i<m;i++) for (int j=1;j<n;j++)
        if (!g[i][j]) dp[i][j]=(dp[i-1][j]+dp[i][j-1])%MOD;
    cout << dp[m-1][n-1] << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int m = in.nextInt(), n = in.nextInt();
        int[][] g = new int[m][n];
        for (int i=0;i<m;i++) for (int j=0;j<n;j++) g[i][j]=in.nextInt();
        long MOD = 1_000_000_007L;
        long[][] dp = new long[m][n];
        for (int i=0;i<m;i++){if(g[i][0]!=0)break; dp[i][0]=1;}
        for (int j=0;j<n;j++){if(g[0][j]!=0)break; dp[0][j]=1;}
        for (int i=1;i<m;i++) for (int j=1;j<n;j++)
            if (g[i][j]==0) dp[i][j]=(dp[i-1][j]+dp[i][j-1])%MOD;
        System.out.println(dp[m-1][n-1]);
    }
}
`.trim(),
  },

  "Cheapest Route": {
    python: `
m, n = map(int, input().split())
grid = [list(map(int, input().split())) for _ in range(m)]
dp = [[0]*n for _ in range(m)]
dp[0][0] = grid[0][0]
for i in range(1, m): dp[i][0] = dp[i-1][0] + grid[i][0]
for j in range(1, n): dp[0][j] = dp[0][j-1] + grid[0][j]
for i in range(1, m):
    for j in range(1, n):
        dp[i][j] = grid[i][j] + min(dp[i-1][j], dp[i][j-1])
print(dp[m-1][n-1])
`.trim(),
    c: `
#include <stdio.h>
int dp[205][205], g[205][205];
int main(void) {
    int m, n; scanf("%d %d", &m, &n);
    for (int i=0;i<m;i++) for (int j=0;j<n;j++) scanf("%d", &g[i][j]);
    dp[0][0] = g[0][0];
    for (int i=1;i<m;i++) dp[i][0]=dp[i-1][0]+g[i][0];
    for (int j=1;j<n;j++) dp[0][j]=dp[0][j-1]+g[0][j];
    for (int i=1;i<m;i++) for (int j=1;j<n;j++) {
        int prev = dp[i-1][j]<dp[i][j-1] ? dp[i-1][j] : dp[i][j-1];
        dp[i][j] = g[i][j]+prev;
    }
    printf("%d\\n", dp[m-1][n-1]);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int m, n; cin >> m >> n;
    vector<vector<int>> g(m,vector<int>(n)), dp(m,vector<int>(n,0));
    for (auto& row:g) for (auto& x:row) cin>>x;
    dp[0][0]=g[0][0];
    for (int i=1;i<m;i++) dp[i][0]=dp[i-1][0]+g[i][0];
    for (int j=1;j<n;j++) dp[0][j]=dp[0][j-1]+g[0][j];
    for (int i=1;i<m;i++) for (int j=1;j<n;j++) dp[i][j]=g[i][j]+min(dp[i-1][j],dp[i][j-1]);
    cout << dp[m-1][n-1] << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int m = in.nextInt(), n = in.nextInt();
        int[][] g=new int[m][n], dp=new int[m][n];
        for (int i=0;i<m;i++) for (int j=0;j<n;j++) g[i][j]=in.nextInt();
        dp[0][0]=g[0][0];
        for (int i=1;i<m;i++) dp[i][0]=dp[i-1][0]+g[i][0];
        for (int j=1;j<n;j++) dp[0][j]=dp[0][j-1]+g[0][j];
        for (int i=1;i<m;i++) for (int j=1;j<n;j++) dp[i][j]=g[i][j]+Math.min(dp[i-1][j],dp[i][j-1]);
        System.out.println(dp[m-1][n-1]);
    }
}
`.trim(),
  },

  "Triangle Descent": {
    python: `
n = int(input())
t = [list(map(int, input().split())) for _ in range(n)]
for i in range(n-2, -1, -1):
    for j in range(i+1):
        t[i][j] += min(t[i+1][j], t[i+1][j+1])
print(t[0][0])
`.trim(),
    c: `
#include <stdio.h>
int t[205][205];
int main(void) {
    int n; scanf("%d", &n);
    for (int i=0;i<n;i++) for (int j=0;j<=i;j++) scanf("%d", &t[i][j]);
    for (int i=n-2;i>=0;i--) for (int j=0;j<=i;j++) {
        int a=t[i+1][j], b=t[i+1][j+1];
        t[i][j] += (a<b?a:b);
    }
    printf("%d\\n", t[0][0]);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<vector<int>> t(n);
    for (int i=0;i<n;i++){t[i].resize(i+1); for (auto& x:t[i]) cin>>x;}
    for (int i=n-2;i>=0;i--) for (int j=0;j<=i;j++) t[i][j]+=min(t[i+1][j],t[i+1][j+1]);
    cout << t[0][0] << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        int[][] t = new int[n][];
        for (int i=0;i<n;i++){t[i]=new int[i+1]; for (int j=0;j<=i;j++) t[i][j]=in.nextInt();}
        for (int i=n-2;i>=0;i--) for (int j=0;j<=i;j++) t[i][j]+=Math.min(t[i+1][j],t[i+1][j+1]);
        System.out.println(t[0][0]);
    }
}
`.trim(),
  },

  "Staircase Ways": {
    python: `
import sys
input = sys.stdin.readline
MOD = 10**9 + 7
n = int(input())
if n == 1: print(1)
elif n == 2: print(2)
else:
    a, b = 1, 2
    for _ in range(n - 2):
        a, b = b, (a + b) % MOD
    print(b)
`.trim(),
    c: `
#include <stdio.h>
#define MOD 1000000007LL
int main(void) {
    long long n; scanf("%lld", &n);
    if (n==1){printf("1\\n");return 0;}
    if (n==2){printf("2\\n");return 0;}
    long long a=1, b=2;
    for (long long i=2;i<n;i++){long long c=(a+b)%MOD; a=b; b=c;}
    printf("%lld\\n", b);
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
const long long MOD = 1e9+7;
int main() {
    long long n; cin >> n;
    if (n==1){cout<<1<<"\\n";return 0;}
    if (n==2){cout<<2<<"\\n";return 0;}
    long long a=1, b=2;
    for (long long i=2;i<n;i++){long long c=(a+b)%MOD; a=b; b=c;}
    cout << b << "\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        long n = in.nextLong(), MOD = 1_000_000_007L;
        if (n==1){System.out.println(1);return;}
        if (n==2){System.out.println(2);return;}
        long a=1, b=2;
        for (long i=2;i<n;i++){long c=(a+b)%MOD; a=b; b=c;}
        System.out.println(b);
    }
}
`.trim(),
  },

  // ── HOPE Assessment — Linked List & Trees ─────────────────────────────────

  "Reverse the Linked List": {
    python: `
n = int(input())
a = list(map(int, input().split()))
print(*a[::-1])
`.trim(),
    c: `
#include <stdio.h>
int main(void) {
    int n; scanf("%d", &n);
    int a[100005];
    for (int i=0;i<n;i++) scanf("%d", &a[i]);
    for (int i=n-1;i>=0;i--) printf("%d%s", a[i], i>0?" ":"\\n");
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin >> n;
    vector<int> a(n);
    for (auto& x:a) cin>>x;
    for (int i=n-1;i>=0;i--) cout<<a[i]<<(i>0?" ":"\\n");
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        int[] a = new int[n];
        for (int i=0;i<n;i++) a[i]=in.nextInt();
        StringBuilder sb = new StringBuilder();
        for (int i=n-1;i>=0;i--){if(i<n-1)sb.append(' ');sb.append(a[i]);}
        System.out.println(sb);
    }
}
`.trim(),
  },

  "Merge Two Sorted Lists": {
    python: `
import sys
data = sys.stdin.read().split()
idx = 0
m = int(data[idx]); idx+=1
a = [int(data[idx+i]) for i in range(m)]; idx+=m
nv = int(data[idx]); idx+=1
b = [int(data[idx+i]) for i in range(nv)]; idx+=nv
i = j = 0
res = []
while i<m and j<nv:
    if a[i]<=b[j]: res.append(a[i]); i+=1
    else: res.append(b[j]); j+=1
res.extend(a[i:]); res.extend(b[j:])
print(*res) if res else print()
`.trim(),
    c: `
#include <stdio.h>
int a[50005], b[50005], res[100005];
int main(void) {
    int m; scanf("%d",&m);
    for (int i=0;i<m;i++) scanf("%d",&a[i]);
    int nv; scanf("%d",&nv);
    for (int i=0;i<nv;i++) scanf("%d",&b[i]);
    int i=0,j=0,k=0;
    while (i<m&&j<nv){if(a[i]<=b[j])res[k++]=a[i++];else res[k++]=b[j++];}
    while (i<m) res[k++]=a[i++];
    while (j<nv) res[k++]=b[j++];
    if (k==0){printf("\\n");}
    else{for(int x=0;x<k;x++) printf("%d%s",res[x],x<k-1?" ":"\\n");}
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int m; cin>>m;
    vector<int> a(m);
    for (auto& x:a) cin>>x;
    int nv; cin>>nv;
    vector<int> b(nv);
    for (auto& x:b) cin>>x;
    int i=0,j=0;
    vector<int> res;
    while (i<m&&j<nv){if(a[i]<=b[j])res.push_back(a[i++]);else res.push_back(b[j++]);}
    while (i<m) res.push_back(a[i++]);
    while (j<nv) res.push_back(b[j++]);
    if (res.empty()){cout<<"\\n";}
    else{for(int k=0;k<(int)res.size();k++) cout<<(k?" ":"")<<res[k];cout<<"\\n";}
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int m=in.nextInt();
        int[] a=new int[m];
        for (int i=0;i<m;i++) a[i]=in.nextInt();
        int nv=in.nextInt();
        int[] b=new int[nv];
        for (int i=0;i<nv;i++) b[i]=in.nextInt();
        int i=0,j=0;
        List<Integer> res=new ArrayList<>();
        while (i<m&&j<nv){if(a[i]<=b[j])res.add(a[i++]);else res.add(b[j++]);}
        while (i<m) res.add(a[i++]);
        while (j<nv) res.add(b[j++]);
        if (res.isEmpty()){System.out.println();}
        else{StringBuilder sb=new StringBuilder();for(int k=0;k<res.size();k++){if(k>0)sb.append(' ');sb.append(res.get(k));}System.out.println(sb);}
    }
}
`.trim(),
  },

  "Binary Tree Level Order Traversal": {
    python: `
from collections import deque
n = int(input())
arr = list(map(int, input().split()))
if n == 0 or arr[0] == -1:
    pass
else:
    q = deque([0])
    while q:
        level_size = len(q)
        vals = []
        for _ in range(level_size):
            idx = q.popleft()
            if idx < n and arr[idx] != -1:
                vals.append(arr[idx])
                l, r = 2*idx+1, 2*idx+2
                if l < n and arr[l] != -1: q.append(l)
                if r < n and arr[r] != -1: q.append(r)
        if vals:
            print(*vals)
`.trim(),
    c: `
#include <stdio.h>
int arr[1005], queue[1005];
int main(void) {
    int n; scanf("%d", &n);
    for (int i=0;i<n;i++) scanf("%d",&arr[i]);
    if (n==0||arr[0]==-1) return 0;
    int head=0, tail=0;
    queue[tail++] = 0;
    while (head < tail) {
        int sz = tail-head;
        int vals[1005], vc=0;
        for (int i=0;i<sz;i++) {
            int idx = queue[head++];
            if (idx<n && arr[idx]!=-1) {
                vals[vc++] = arr[idx];
                int l=2*idx+1, r=2*idx+2;
                if (l<n && arr[l]!=-1) queue[tail++]=l;
                if (r<n && arr[r]!=-1) queue[tail++]=r;
            }
        }
        if (vc>0){for(int i=0;i<vc;i++) printf("%d%s",vals[i],i<vc-1?" ":"\\n");}
    }
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n; cin>>n;
    vector<int> arr(n);
    for (auto& x:arr) cin>>x;
    if (n==0||arr[0]==-1) return 0;
    queue<int> q; q.push(0);
    while (!q.empty()) {
        int sz=q.size();
        vector<int> level;
        for (int i=0;i<sz;i++){
            int idx=q.front(); q.pop();
            if (idx<n&&arr[idx]!=-1){
                level.push_back(arr[idx]);
                int l=2*idx+1,r=2*idx+2;
                if (l<n&&arr[l]!=-1) q.push(l);
                if (r<n&&arr[r]!=-1) q.push(r);
            }
        }
        if (!level.empty()){for(int i=0;i<(int)level.size();i++) cout<<(i?" ":"")<<level[i];cout<<"\\n";}
    }
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        int[] arr = new int[n];
        for (int i=0;i<n;i++) arr[i]=in.nextInt();
        if (n==0||arr[0]==-1) return;
        Queue<Integer> q = new ArrayDeque<>(); q.add(0);
        while (!q.isEmpty()) {
            int sz = q.size();
            List<Integer> level = new ArrayList<>();
            for (int i=0;i<sz;i++){
                int idx=q.poll();
                if (idx<n&&arr[idx]!=-1){
                    level.add(arr[idx]);
                    int l=2*idx+1,r=2*idx+2;
                    if (l<n&&arr[l]!=-1) q.add(l);
                    if (r<n&&arr[r]!=-1) q.add(r);
                }
            }
            if (!level.isEmpty()){StringBuilder sb=new StringBuilder();for(int i=0;i<level.size();i++){if(i>0)sb.append(' ');sb.append(level.get(i));}System.out.println(sb);}
        }
    }
}
`.trim(),
  },

  "BST: Build and Traverse": {
    python: `
import sys
sys.setrecursionlimit(200000)
input = sys.stdin.readline
n = int(input())
vals = list(map(int, input().split()))
class Node:
    __slots__ = ['v','l','r']
    def __init__(self,v): self.v=v; self.l=self.r=None
def insert(root, v):
    if root is None: return Node(v)
    if v < root.v: root.l = insert(root.l, v)
    elif v > root.v: root.r = insert(root.r, v)
    return root
def inorder(node, res):
    if node is None: return
    inorder(node.l, res); res.append(node.v); inorder(node.r, res)
root = None
for v in vals: root = insert(root, v)
res = []
inorder(root, res)
print(*res)
`.trim(),
    c: `
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int v; struct Node *l, *r; } Node;
Node* newNode(int v){Node*n=malloc(sizeof(Node));n->v=v;n->l=n->r=NULL;return n;}
Node* insert(Node*r,int v){if(!r)return newNode(v);if(v<r->v)r->l=insert(r->l,v);else if(v>r->v)r->r=insert(r->r,v);return r;}
int first = 1;
void inorder(Node*n){if(!n)return;inorder(n->l);printf("%s%d",first?"":" ",n->v);first=0;inorder(n->r);}
int main(void){
    int n; scanf("%d",&n);
    Node*root=NULL;
    for(int i=0;i<n;i++){int v;scanf("%d",&v);root=insert(root,v);}
    inorder(root); printf("\\n");
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
struct Node{int v;Node*l,*r;Node(int v):v(v),l(nullptr),r(nullptr){}};
Node* insert(Node*r,int v){if(!r)return new Node(v);if(v<r->v)r->l=insert(r->l,v);else if(v>r->v)r->r=insert(r->r,v);return r;}
void inorder(Node*n,vector<int>&res){if(!n)return;inorder(n->l,res);res.push_back(n->v);inorder(n->r,res);}
int main(){
    int n; cin>>n;
    Node*root=nullptr;
    for(int i=0;i<n;i++){int v;cin>>v;root=insert(root,v);}
    vector<int>res; inorder(root,res);
    for(int i=0;i<(int)res.size();i++) cout<<(i?" ":"")<<res[i]; cout<<"\\n";
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    static int[] V, L, R; static int root=-1, cnt=0;
    static int insert(int node,int v){
        if(node==-1){V[cnt]=v;L[cnt]=R[cnt]=-1;return cnt++;}
        if(v<V[node])L[node]=insert(L[node],v);
        else if(v>V[node])R[node]=insert(R[node],v);
        return node;
    }
    static void inorder(int node,List<Integer> res){if(node==-1)return;inorder(L[node],res);res.add(V[node]);inorder(R[node],res);}
    public static void main(String[] args){
        Scanner in=new Scanner(System.in);
        int n=in.nextInt();
        V=new int[n];L=new int[n];R=new int[n];
        for(int i=0;i<n;i++){int v=in.nextInt();root=insert(root,v);}
        List<Integer> res=new ArrayList<>(); inorder(root,res);
        StringBuilder sb=new StringBuilder();
        for(int i=0;i<res.size();i++){if(i>0)sb.append(' ');sb.append(res.get(i));}
        System.out.println(sb);
    }
}
`.trim(),
  },

  "Lowest Common Ancestor in BST": {
    python: `
import sys
sys.setrecursionlimit(200000)
input = sys.stdin.readline
n = int(input())
vals = list(map(int, input().split()))
class Node:
    __slots__ = ['v','l','r']
    def __init__(self,v): self.v=v; self.l=self.r=None
def insert(root, v):
    if root is None: return Node(v)
    if v < root.v: root.l = insert(root.l, v)
    elif v > root.v: root.r = insert(root.r, v)
    return root
root = None
for v in vals: root = insert(root, v)
def lca(node, p, q):
    lo, hi = min(p,q), max(p,q)
    while node:
        if hi < node.v: node = node.l
        elif lo > node.v: node = node.r
        else: return node.v
q_count = int(input())
for _ in range(q_count):
    p, q = map(int, input().split())
    print(lca(root, p, q))
`.trim(),
    c: `
#include <stdio.h>
#include <stdlib.h>
typedef struct Node{int v;struct Node*l,*r;}Node;
Node*newNode(int v){Node*n=malloc(sizeof(Node));n->v=v;n->l=n->r=NULL;return n;}
Node*insert(Node*r,int v){if(!r)return newNode(v);if(v<r->v)r->l=insert(r->l,v);else if(v>r->v)r->r=insert(r->r,v);return r;}
int lca(Node*root,int p,int q){
    int lo=p<q?p:q, hi=p>q?p:q;
    while(root){if(hi<root->v)root=root->l;else if(lo>root->v)root=root->r;else return root->v;}
    return -1;
}
int main(void){
    int n;scanf("%d",&n);
    Node*root=NULL;
    for(int i=0;i<n;i++){int v;scanf("%d",&v);root=insert(root,v);}
    int Q;scanf("%d",&Q);
    while(Q--){int p,q;scanf("%d %d",&p,&q);printf("%d\\n",lca(root,p,q));}
    return 0;
}
`.trim(),
    cpp: `
#include <bits/stdc++.h>
using namespace std;
struct Node{int v;Node*l,*r;Node(int v):v(v),l(nullptr),r(nullptr){}};
Node*insert(Node*r,int v){if(!r)return new Node(v);if(v<r->v)r->l=insert(r->l,v);else if(v>r->v)r->r=insert(r->r,v);return r;}
int lca(Node*root,int p,int q){
    int lo=min(p,q),hi=max(p,q);
    while(root){if(hi<root->v)root=root->l;else if(lo>root->v)root=root->r;else return root->v;}
    return -1;
}
int main(){
    int n;cin>>n;
    Node*root=nullptr;
    for(int i=0;i<n;i++){int v;cin>>v;root=insert(root,v);}
    int Q;cin>>Q;
    while(Q--){int p,q;cin>>p>>q;cout<<lca(root,p,q)<<"\\n";}
}
`.trim(),
    java: `
import java.util.*;
public class Main {
    static int[] V,L,R; static int root=-1,cnt=0;
    static int insert(int node,int v){if(node==-1){V[cnt]=v;L[cnt]=R[cnt]=-1;return cnt++;}if(v<V[node])L[node]=insert(L[node],v);else if(v>V[node])R[node]=insert(R[node],v);return node;}
    static int lca(int node,int p,int q){
        int lo=Math.min(p,q),hi=Math.max(p,q);
        while(node!=-1){if(hi<V[node])node=L[node];else if(lo>V[node])node=R[node];else return V[node];}
        return -1;
    }
    public static void main(String[] args){
        Scanner in=new Scanner(System.in);
        int n=in.nextInt();
        V=new int[n];L=new int[n];R=new int[n];
        for(int i=0;i<n;i++){int v=in.nextInt();root=insert(root,v);}
        int Q=in.nextInt();
        StringBuilder sb=new StringBuilder();
        while(Q-->0){int p=in.nextInt(),q=in.nextInt();sb.append(lca(root,p,q)).append("\\n");}
        System.out.print(sb);
    }
}
`.trim(),
  },
};

// ─── Runner ───────────────────────────────────────────────────────────────────

const LANGS = ["python", "c", "cpp", "java"] as const;

interface QuestionRow { id: string; title: string; time_limit_ms: number; exam_title: string; }
interface TestCaseRow { ord: number; input: string; expected_output: string; is_sample: boolean; }

const questions = await db<QuestionRow[]>`
  SELECT DISTINCT q.id, q.title, q.time_limit_ms, e.title as exam_title
  FROM questions q
  JOIN exam_questions eq ON eq.question_id = q.id
  JOIN exams e ON e.id = eq.exam_id
  WHERE e.title LIKE 'HOPE Assessment%'
  ORDER BY e.title, q.title
`;

let totalPass = 0, totalFail = 0, totalSkip = 0;
const failedItems: string[] = [];

for (const q of questions) {
  const testCases = await db<TestCaseRow[]>`
    SELECT ord, input, expected_output, is_sample
    FROM test_cases WHERE question_id = ${q.id} ORDER BY ord
  `;

  console.log(`\n━━━ ${q.exam_title} › ${q.title} (${testCases.length} cases) ━━━`);

  const solutions = SOLUTIONS[q.title];
  if (!solutions) {
    console.log(`  ⚠  No reference solution — SKIPPED`);
    totalSkip += LANGS.length;
    continue;
  }

  const inputs = testCases.map(t => t.input);

  for (const lang of LANGS) {
    const source = solutions[lang];
    if (!source) {
      console.log(`  [${lang.padEnd(6)}] ⚠  No solution — skipped`);
      totalSkip++;
      continue;
    }

    const started = Date.now();
    let batchResult: BatchExecResult;
    try {
      batchResult = await engine.executeBatch({
        language: lang,
        source,
        inputs,
        timeLimitMs: q.time_limit_ms,
        memoryLimitKb: 262144,
      });
    } catch (e: any) {
      console.log(`  [${lang.padEnd(6)}] ✗ ENGINE ERROR: ${e.message}`);
      totalFail++;
      failedItems.push(`${q.title} [${lang}]: engine error`);
      continue;
    }

    if ("compileError" in batchResult) {
      const ce = batchResult.compileError.slice(0, 200).replace(/\n/g, " ");
      console.log(`  [${lang.padEnd(6)}] ✗ COMPILE ERROR: ${ce}`);
      totalFail += testCases.length;
      failedItems.push(`${q.title} [${lang}]: compile error`);
      continue;
    }

    const results = batchResult.results;
    let pass = 0, fail = 0;
    const failDetails: string[] = [];

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i];
      const r = results[i];
      const label = `case ${tc.ord}(${tc.is_sample ? "sample" : "hidden"})`;
      if (r.status !== "ok") {
        fail++;
        failDetails.push(`${label}: ${r.status}`);
      } else if (normalizeOutput(r.stdout) !== normalizeOutput(tc.expected_output)) {
        fail++;
        const got = normalizeOutput(r.stdout).slice(0, 60);
        const exp = normalizeOutput(tc.expected_output).slice(0, 60);
        failDetails.push(`${label}: WA got="${got}" exp="${exp}"`);
      } else {
        pass++;
      }
    }

    const elapsed = Date.now() - started;
    const mark = fail === 0 ? "✓" : "✗";
    console.log(`  [${lang.padEnd(6)}] ${mark}  ${pass}/${testCases.length} passed  (${elapsed}ms)`);
    if (failDetails.length > 0) {
      failDetails.slice(0, 4).forEach(d => console.log(`         ${d}`));
      if (failDetails.length > 4) console.log(`         ... and ${failDetails.length - 4} more`);
      failedItems.push(`${q.title} [${lang}]`);
    }
    totalPass += pass;
    totalFail += fail;
  }
}

console.log(`\n${"═".repeat(60)}`);
console.log(`TOTAL: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`);
if (failedItems.length > 0) {
  console.log(`\nFailed:`);
  failedItems.forEach(f => console.log(`  - ${f}`));
}
console.log(`${"═".repeat(60)}`);

await db.end();
process.exit(totalFail > 0 ? 1 : 0);
