import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import styles from "./test-runner.module.css";

const { kw, fn, nu, cm } = styles;

// A real solution, so students who read it see code that works.
const LINES: ReactNode[] = [
  <><span className={cm}># pairs in nums that add up to k</span></>,
  <><span className={kw}>def</span> <span className={fn}>count_pairs</span>(nums, k):</>,
  <>    seen, pairs = {"{}"}, <span className={nu}>0</span></>,
  <>    <span className={kw}>for</span> x <span className={kw}>in</span> nums:</>,
  <>        pairs += seen.get(k - x, <span className={nu}>0</span>)</>,
  <>        seen[x] = seen.get(x, <span className={nu}>0</span>) + <span className={nu}>1</span></>,
  <>    <span className={kw}>return</span> pairs</>,
  <> </>,
  <>n, k = <span className={fn}>map</span>(<span className={fn}>int</span>, <span className={fn}>input</span>().split())</>,
  <><span className={fn}>print</span>(count_pairs(<span className={fn}>list</span>(<span className={fn}>map</span>(<span className={fn}>int</span>, <span className={fn}>input</span>().split())), k))</>,
];

const TESTS = [
  { name: "Sample 1", time: "0.03s" },
  { name: "Sample 2", time: "0.02s" },
  { name: "Hidden 1", time: "0.04s" },
  { name: "Hidden 2", time: "0.11s" },
  { name: "Hidden 3", time: "0.09s" },
];

/** Decorative: plays once on load. Screen readers get one sentence instead. */
export function TestRunner() {
  return (
    <figure className={styles.panel}>
      <figcaption className="sr-only">A solution running against its test cases, all five passing.</figcaption>
      <div aria-hidden>
        <div className={styles.bar}>
          <span className={styles.tab}>solution.py</span>
          <span>Python 3</span>
        </div>
        <pre className={styles.code}>
          {LINES.map((line, i) => (
            <span key={i} className={styles.line} style={{ "--i": i } as CSSProperties}>
              {line}
            </span>
          ))}
        </pre>
        <div className={styles.results}>
          <ul className={styles.tests}>
            {TESTS.map((test, i) => (
              <li key={test.name} className={styles.test} style={{ "--done": `${1.9 + i * 0.3}s` } as CSSProperties}>
                <span className={styles.mark}>
                  <span className={styles.running} />
                  <span className={styles.passed}>
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                </span>
                <span>{test.name}</span>
                <span className={styles.time}>{test.time}</span>
              </li>
            ))}
          </ul>
          <div className={styles.summary}>
            <span className={styles.summaryState}>
              <span className={styles.pending}>Running test cases</span>
              <span className={styles.score}>5 of 5 test cases passed</span>
            </span>
            <span className="text-[12px] text-[#8794a0]">Max score 100</span>
          </div>
        </div>
      </div>
    </figure>
  );
}
