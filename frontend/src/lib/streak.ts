const shift = (day: string, by: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
};

/** The run of consecutive active days ending today, or yesterday (a streak lives until the day after). */
export function currentStreak(activeDays: string[], today: string): number {
  const days = new Set(activeDays);
  let cursor = days.has(today) ? today : shift(today, -1);
  let run = 0;
  while (days.has(cursor)) {
    run++;
    cursor = shift(cursor, -1);
  }
  return run;
}

/** The last `weeks` weeks as columns of 7 days (Monday first), oldest first, each marked active or not. */
export function weekGrid(activeDays: string[], today: string, weeks = 14): { day: string; active: boolean; future: boolean }[][] {
  const days = new Set(activeDays);
  const mondayOffset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = shift(today, -mondayOffset - (weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const day = shift(start, week * 7 + weekday);
      return { day, active: days.has(day), future: day > today };
    }),
  );
}
