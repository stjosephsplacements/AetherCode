import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui";

export const metadata: Metadata = {
  title: "Troubleshooting FAQ — AetherCode",
  description:
    "Common issues and fixes for HOPE Assessment students and trainers",
};

function Q({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-t-[var(--radius-card)] border-b border-line bg-error-soft px-5 py-4 font-semibold text-[0.92rem] leading-relaxed text-ink">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-error text-[0.65rem] font-bold text-white">
        !
      </span>
      <span>{children}</span>
    </div>
  );
}

function A({ children }: { children: React.ReactNode }) {
  return <div className="prose-exam px-5 py-4">{children}</div>;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {children}
    </div>
  );
}

function Badge({ variant, children }: { variant: "fix" | "info" | "warn"; children: React.ReactNode }) {
  const cls = {
    fix: "bg-pass-soft text-pass",
    info: "bg-brand-soft text-brand",
    warn: "bg-accent-soft text-accent",
  }[variant];
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-r-lg border-l-3 border-accent bg-accent-soft px-4 py-3 text-[0.88rem]">
      {children}
    </div>
  );
}

export default function FaqPage() {
  return (
    <main className="min-h-dvh bg-canvas">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-6">
        <Link href="/">
          <Logo />
        </Link>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted">
          October 2026
        </span>
      </header>

      <div className="mx-auto max-w-3xl px-5 pb-20">
        <div className="mb-10 border-b-2 border-brand pb-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            HOPE Assessment &mdash; Troubleshooting FAQ
          </h1>
          <p className="mt-2 text-[0.95rem] text-muted">
            Common issues and fixes for students and trainers on AetherCode
          </p>
        </div>

        {/* Table of contents */}
        <nav className="mb-10 rounded-[var(--radius-card)] border border-line bg-sunken px-6 py-5">
          <h2 className="mb-3 text-[0.75rem] font-semibold uppercase tracking-widest text-faint">
            Contents
          </h2>
          <ol className="list-decimal space-y-1.5 pl-5 text-[0.9rem] marker:text-faint">
            <li><a href="#seb-vm" className="text-brand hover:underline">SEB: &quot;Virtual Machine Detected&quot; error</a></li>
            <li><a href="#seb-password" className="text-brand hover:underline">SEB: Asking for unlock / quit password</a></li>
            <li><a href="#seb-white" className="text-brand hover:underline">SEB: Blank white screen after login</a></li>
            <li><a href="#seb-old-mac" className="text-brand hover:underline">SEB: Not loading on older MacBooks</a></li>
            <li><a href="#judge-error" className="text-brand hover:underline">&quot;The judge could not evaluate this submission&quot;</a></li>
            <li><a href="#java-class" className="text-brand hover:underline">Java: &quot;class not found&quot; or multiple public classes</a></li>
            <li><a href="#java-nonstatic" className="text-brand hover:underline">Java: &quot;non-static variable this cannot be referenced&quot;</a></li>
            <li><a href="#java-nosuchelement" className="text-brand hover:underline">Java: &quot;NoSuchElementException&quot; on input</a></li>
            <li><a href="#general-tips" className="text-brand hover:underline">General tips for writing solutions</a></li>
          </ol>
        </nav>

        <div className="space-y-12">
          {/* 1. SEB VM Detected */}
          <section id="seb-vm">
            <h2 className="mb-4 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
              1. SEB: &quot;Virtual Machine Detected&quot;
            </h2>
            <Card>
              <Q>Safe Exam Browser shows &quot;Virtual Machine Detected&quot; and refuses to start the exam, even though I&apos;m on a physical laptop.</Q>
              <A>
                <Badge variant="fix">Fix</Badge>
                <p>
                  SEB detects the Windows hypervisor layer (Hyper-V, Memory Integrity, WSL2, Docker, etc.) and mistakes your physical machine for a virtual one. You need to disable all virtualization features.
                </p>

                <h3>Step 1 &mdash; Turn off hypervisor features</h3>
                <ol>
                  <li>Press <code>Win + R</code>, type <code>optionalfeatures</code>, hit Enter.</li>
                  <li>Uncheck <strong>all</strong> of: Hyper-V &bull; Virtual Machine Platform &bull; Windows Hypervisor Platform &bull; Windows Subsystem for Linux &bull; Windows Sandbox &bull; Containers</li>
                  <li>Click OK. <strong>Do not restart yet.</strong></li>
                </ol>

                <h3>Step 2 &mdash; Turn off Memory Integrity</h3>
                <ol>
                  <li>Open <strong>Settings &rarr; Privacy &amp; Security &rarr; Windows Security &rarr; Device Security</strong>.</li>
                  <li>Click <strong>Core isolation details</strong>.</li>
                  <li>Set <strong>Memory integrity</strong> to <strong>OFF</strong>.</li>
                </ol>

                <h3>Step 3 &mdash; Disable hypervisor at boot</h3>
                <ol>
                  <li>Open <strong>Command Prompt as Administrator</strong>.</li>
                  <li>Run:</li>
                </ol>
                <pre><code>bcdedit /set hypervisorlaunchtype off</code></pre>

                <h3>Step 4 &mdash; Check BIOS (if steps 1&ndash;3 didn&apos;t help)</h3>
                <ol>
                  <li>Restart and enter BIOS (usually <code>F2</code>, <code>Del</code>, or <code>F10</code> during boot).</li>
                  <li>Find <strong>Virtualization Technology</strong> (Intel VT-x / AMD-V) and <strong>disable</strong> it.</li>
                  <li>Save and exit BIOS.</li>
                </ol>

                <h3>Step 5 &mdash; Restart your computer</h3>
                <p>A restart is required after every change above. Then re-open SEB and try again.</p>

                <Callout>
                  <strong>Important:</strong> After the exam, re-enable all these features by reversing the steps above and running <code>bcdedit /set hypervisorlaunchtype auto</code>.
                </Callout>
              </A>
            </Card>
          </section>

          {/* 2. SEB Password */}
          <section id="seb-password">
            <h2 className="mb-4 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
              2. SEB: Asking for Unlock / Quit Password
            </h2>
            <Card>
              <Q>I exited the exam or SEB crashed, and now it&apos;s asking for a quit password / unlock password.</Q>
              <A>
                <Badge variant="info">Why this happens</Badge>
                <p>SEB locks you into the exam session. If you try to quit SEB, switch to another app, or force-close it, SEB requires a password to exit or to re-enter the session.</p>

                <Badge variant="fix">Fix</Badge>
                <p>The quit password is:</p>
                <pre><code>REDACTED</code></pre>
                <p>Type it in the password dialog and press Enter. SEB will close. Then re-open SEB from the exam link on the portal to continue your exam.</p>

                <Callout>
                  <strong>Note:</strong> Your exam timer is server-controlled. The time continues even when SEB is closed. Re-enter the exam as quickly as possible.
                </Callout>
              </A>
            </Card>
          </section>

          {/* 3. SEB White Screen */}
          <section id="seb-white">
            <h2 className="mb-4 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
              3. SEB: Blank White Screen
            </h2>
            <Card>
              <Q>After entering the password or opening SEB, I only see a blank white screen. Questions are not visible.</Q>
              <A>
                <Badge variant="info">Why this happens</Badge>
                <p>This is usually a network or browser cache issue inside SEB. The page failed to load the exam content.</p>

                <Badge variant="fix">Fix</Badge>
                <ol>
                  <li>Press <code>Ctrl + R</code> (or <code>Cmd + R</code> on Mac) inside SEB to reload the page.</li>
                  <li>If that doesn&apos;t work, quit SEB using the quit password: <code>REDACTED</code></li>
                  <li><strong>Force shut down</strong> the laptop (hold the power button for 5 seconds).</li>
                  <li>Turn it back on, reopen SEB from the exam link, and log in again.</li>
                </ol>
                <p>If the problem persists after a full restart, check your Wi-Fi / LAN connection. Try moving closer to the access point or switching to a wired connection if available.</p>
              </A>
            </Card>
          </section>

          {/* 4. Old Mac */}
          <section id="seb-old-mac">
            <h2 className="mb-4 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
              4. SEB: Not Loading on Older MacBooks
            </h2>
            <Card>
              <Q>SEB shows a blank screen or fails to load on my older MacBook (pre-2017 / macOS 12 or earlier).</Q>
              <A>
                <Badge variant="warn">Known limitation</Badge>
                <p>Very old MacBooks running macOS Monterey (12) or earlier have compatibility issues with the latest SEB version. The WebKit engine in these older macOS versions cannot render the exam interface properly.</p>

                <Badge variant="fix">Workaround</Badge>
                <ol>
                  <li>Force shut down the MacBook and restart it.</li>
                  <li>Try downloading the latest version of SEB from <code>safeexambrowser.org/download</code>.</li>
                  <li>If it still doesn&apos;t work, <strong>contact your trainer</strong> to arrange access from a different machine (lab desktop or a newer laptop).</li>
                </ol>
              </A>
            </Card>
          </section>

          {/* 5. Judge Error */}
          <section id="judge-error">
            <h2 className="mb-4 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
              5. &quot;The judge could not evaluate this submission&quot;
            </h2>
            <Card>
              <Q>When I click Run or Submit, the error says &quot;The judge could not evaluate this submission. Please try again.&quot;</Q>
              <A>
                <Badge variant="info">Why this happens</Badge>
                <p>This usually means the execution engine was temporarily unreachable &mdash; either due to a brief network interruption on the server side, or the engine was under heavy load from many concurrent submissions.</p>

                <Badge variant="fix">Fix</Badge>
                <ol>
                  <li><strong>Wait 10&ndash;15 seconds</strong> and try clicking <strong>Run</strong> or <strong>Submit</strong> again.</li>
                  <li>If it still fails, check if your internet connection is stable.</li>
                  <li>Try saving your code (it auto-saves as a draft), then <strong>reload the page</strong> with <code>Ctrl + R</code>.</li>
                  <li>If the error persists for more than 2&ndash;3 minutes, <strong>inform your trainer</strong> &mdash; it may be a server-side issue that the admin needs to resolve.</li>
                </ol>

                <Callout>
                  <strong>Your code is safe.</strong> Drafts are saved automatically. Even if the page reloads, your latest code for each question will still be there.
                </Callout>
              </A>
            </Card>
          </section>

          {/* 6. Java class error */}
          <section id="java-class">
            <h2 className="mb-4 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
              6. Java: &quot;class not found&quot; or Multiple Public Classes
            </h2>
            <Card>
              <Q>My Java code compiles on my laptop but gives &quot;class not found&quot; or &quot;Main has private access&quot; on the exam platform.</Q>
              <A>
                <Badge variant="info">Why this happens</Badge>
                <p>On the AetherCode platform, all your code goes into a single file called <code>Main.java</code>. Java only allows <strong>one public class per file</strong>, and it <strong>must</strong> be named <code>Main</code>.</p>

                <Badge variant="fix">Fix</Badge>
                <p><strong>Rule:</strong> Only <code>public class Main</code> should be public. All other classes must drop the <code>public</code> keyword.</p>

                <p><strong>Wrong:</strong></p>
                <pre><code>{`public class Node {       // ERROR: can't have two public classes
    int val;
    Node next;
}
public class Main {
    public static void main(String[] args) { ... }
}`}</code></pre>

                <p><strong>Correct (option A &mdash; remove <code>public</code>):</strong></p>
                <pre><code>{`class Node {              // no "public" keyword
    int val;
    Node next;
}
public class Main {
    public static void main(String[] args) { ... }
}`}</code></pre>

                <p><strong>Correct (option B &mdash; static inner class):</strong></p>
                <pre><code>{`public class Main {
    static class Node {   // inner class with "static"
        int val;
        Node next;
    }
    public static void main(String[] args) { ... }
}`}</code></pre>
              </A>
            </Card>
          </section>

          {/* 7. Java non-static */}
          <section id="java-nonstatic">
            <h2 className="mb-4 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
              7. Java: &quot;non-static variable this cannot be referenced&quot;
            </h2>
            <Card>
              <Q>I get &quot;non-static variable this cannot be referenced from a static context&quot; when using my helper class.</Q>
              <A>
                <Badge variant="info">Why this happens</Badge>
                <p>If you define a helper class (like <code>Node</code>, <code>TreeNode</code>, <code>Pair</code>) as an inner class of <code>Main</code> <em>without</em> the <code>static</code> keyword, Java treats it as tied to an instance of <code>Main</code>. Since <code>main()</code> is static, you can&apos;t create non-static inner class instances from it.</p>

                <Badge variant="fix">Fix</Badge>
                <p>Add the <code>static</code> keyword to your inner class:</p>
                <pre><code>{`public class Main {
    static class Node {       // ADD "static" here
        int val;
        Node left, right;
        Node(int v) { val = v; }
    }

    public static void main(String[] args) {
        Node root = new Node(1);  // now works
    }
}`}</code></pre>
              </A>
            </Card>
          </section>

          {/* 8. Java NoSuchElement */}
          <section id="java-nosuchelement">
            <h2 className="mb-4 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
              8. Java: &quot;NoSuchElementException&quot; on Input
            </h2>
            <Card>
              <Q>My code throws <code>java.util.NoSuchElementException</code> when reading input.</Q>
              <A>
                <Badge variant="info">Why this happens</Badge>
                <p>Your code is trying to read more input than what&apos;s provided. Common causes:</p>
                <ul>
                  <li>Using <code>sc.nextInt()</code> or <code>sc.next()</code> more times than there are values in the input.</li>
                  <li>Off-by-one loop: e.g., looping <code>N+1</code> times instead of <code>N</code>.</li>
                  <li>Wrong variable in a loop index (e.g., <code>grid[i][j] = sc.nextInt()</code> but using <code>i</code> where you meant <code>j</code>).</li>
                  <li>Calling <code>sc.nextLine()</code> after <code>sc.nextInt()</code> without consuming the leftover newline.</li>
                </ul>

                <Badge variant="fix">Fix</Badge>
                <ol>
                  <li>Read the input format in the problem statement carefully. Count how many values your code reads vs. how many the input provides.</li>
                  <li>Check your loop bounds. If the input says <code>N</code> values, your loop should run exactly <code>N</code> times.</li>
                  <li>If mixing <code>nextInt()</code> and <code>nextLine()</code>, add a bare <code>sc.nextLine()</code> after <code>nextInt()</code> to consume the trailing newline:</li>
                </ol>
                <pre><code>{`int n = sc.nextInt();
sc.nextLine();            // consume the newline
String line = sc.nextLine(); // now reads correctly`}</code></pre>
              </A>
            </Card>
          </section>

          {/* 9. General Tips */}
          <section id="general-tips">
            <h2 className="mb-4 border-b border-line pb-2 font-display text-lg font-semibold text-ink">
              9. General Tips for Writing Solutions
            </h2>
            <Card>
              <div className="flex items-start gap-3 rounded-t-[var(--radius-card)] border-b border-line bg-brand-soft px-5 py-4 font-semibold text-[0.92rem] leading-relaxed text-ink">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-[0.65rem] font-bold text-white">
                  i
                </span>
                <span>Best practices to avoid common errors on AetherCode</span>
              </div>
              <A>
                <h3>For all languages</h3>
                <ul>
                  <li>Read the <strong>Input Format</strong> and <strong>Output Format</strong> sections carefully. Match the exact format &mdash; no extra spaces, no debug prints.</li>
                  <li>Do not print prompts like <code>&quot;Enter N:&quot;</code>. Only print the answer.</li>
                  <li>Use the <strong>Run</strong> button with custom input to test your code before clicking <strong>Submit</strong>.</li>
                  <li>Your code is <strong>auto-saved as a draft</strong>. If the page reloads, your latest code will be restored.</li>
                </ul>

                <h3>For Java</h3>
                <ul>
                  <li>Your main class must be <code>public class Main</code>.</li>
                  <li>All other classes must <strong>not</strong> be <code>public</code> (or use <code>static</code> inner classes).</li>
                  <li>Use <code>BufferedReader</code> + <code>StringTokenizer</code> instead of <code>Scanner</code> for large inputs &mdash; it&apos;s significantly faster.</li>
                  <li>Use <code>StringBuilder</code> for building output instead of <code>System.out.println()</code> in a loop.</li>
                </ul>

                <h3>For C/C++</h3>
                <ul>
                  <li>Use <code>scanf</code>/<code>printf</code> or add <code>ios::sync_with_stdio(false); cin.tie(nullptr);</code> for fast I/O.</li>
                  <li>The main function must be <code>int main()</code>.</li>
                </ul>

                <h3>For Python</h3>
                <ul>
                  <li>Use <code>sys.stdin</code> for reading large inputs: <code>input = sys.stdin.readline</code>.</li>
                  <li>Avoid recursion depth issues: add <code>sys.setrecursionlimit(200000)</code> if using deep recursion.</li>
                </ul>
              </A>
            </Card>
          </section>
        </div>

        <footer className="mt-14 border-t border-line pt-6 text-center text-sm text-faint">
          AetherCode Assessment Platform &bull; HOPE Programming Training &bull; SJCE &bull; October 2026
        </footer>
      </div>
    </main>
  );
}
