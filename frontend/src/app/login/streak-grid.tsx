import type { CSSProperties } from "react";
import styles from "./streak-grid.module.css";

const COLUMNS = 30;
const ROWS = 7;

// Deterministic, so the server and browser draw the same grid (no hydration mismatch).
function level(column: number, row: number): number {
  let hash = (column * 73856093) ^ (row * 19349663);
  hash = (hash ^ (hash >>> 13)) * 1274126177;
  const value = ((hash ^ (hash >>> 16)) >>> 0) % 100;
  // Busier towards the right: a streak that builds up.
  const bias = column / COLUMNS;
  if (value < 28 - bias * 18) return 0;
  if (value < 55) return 1;
  if (value < 78 + bias * 8) return 2;
  if (value < 92) return 3;
  return 4;
}

/** A contribution-style grid that lights up in one wave from left to right. Decorative. */
export function StreakGrid() {
  return (
    <div aria-hidden className={styles.grid} style={{ "--columns": COLUMNS } as CSSProperties}>
      {Array.from({ length: COLUMNS * ROWS }, (_, index) => {
        const column = Math.floor(index / ROWS);
        const row = index % ROWS;
        return (
          <span
            key={index}
            className={styles.cell}
            data-level={level(column, row)}
            style={{ "--delay": `${column * 45 + row * 12}ms` } as CSSProperties}
          />
        );
      })}
    </div>
  );
}
