import { CaretLeft, CaretRight, Warning } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { ExamPeek, examState } from "@/components/staff/exam-peek";
import { LoadError } from "@/components/staff/page-header";
import { Tile } from "@/components/staff/tile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { ExamVersion } from "@/lib/api-types";
import { daysOfWindow, monthGrid, monthOf, overlappingPairs, parseMonth, shiftMonth, sharedWindow } from "@/lib/calendar";
import { type ExamWithVersion, listExams } from "@/lib/server/exams";
import { requireCollege } from "@/lib/server/staff";
import { TIME_ZONE, cn, formatDateTime, formatTime } from "@/lib/utils";
import { NewExamDialog } from "../exams/new-exam-dialog";

export const metadata: Metadata = { title: "Calendar" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Exams shown in a day before the rest fold into "+N more". */
const CHIPS = 3;

type Entry = { examId: string; version: ExamVersion; opensAt: string; closesAt: string; first: boolean; college?: { id: string; name: string } };
type State = ReturnType<typeof examState>;

const CHIP: Record<State, string> = {
  live: "bg-brand text-brand-ink",
  next: "bg-brand-soft text-brand-soft-ink",
  closed: "bg-hover text-ink-muted",
  draft: "border border-dashed border-line-strong text-ink-muted",
};
const STATE_NAME: Record<State, string> = { live: "Live now", next: "Scheduled", closed: "Closed", draft: "Draft" };

const dayName = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

function Chip({ entry, state, now }: { entry: Entry; state: State; now: number }) {
  return (
    <ExamPeek
      exam={{ exam: { id: entry.examId }, version: entry.version, college: entry.college }}
      now={now}
      label={`${entry.version.title}, ${STATE_NAME[state].toLowerCase()}, ${formatDateTime(entry.opensAt)}`}
      className={cn("flex h-6 w-full items-center gap-1.5 rounded-[6px] px-1.5 text-[12px] font-medium transition-[filter] hover:brightness-110", CHIP[state])}
    >
      <span className="shrink-0 font-mono text-[10.5px] opacity-80">{entry.first ? formatTime(entry.opensAt) : "cont."}</span>
      <span className="truncate">{entry.version.title}</span>
    </ExamPeek>
  );
}

/** A day with more exams than fit: all of them, in a modal. */
function DayDialog({ dayKey, entries, now }: { dayKey: string; entries: Entry[]; now: number }) {
  return (
    <Dialog>
      <DialogTrigger className="w-full rounded-[6px] px-1.5 py-0.5 text-left font-mono text-[11px] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
        + {entries.length - CHIPS} more
      </DialogTrigger>
      <DialogContent title={dayName.format(new Date(`${dayKey}T00:00:00Z`))} description={`${entries.length} exams touch this day.`}>
        <ul className="min-h-0 space-y-1 overflow-y-auto p-4">
          {entries.map((entry) => (
            <li key={entry.examId}>
              <Chip entry={entry} state={examState(entry.version, now)} now={now} />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireCollege();
  const now = new Date().getTime();
  const today = todayKey.format(now);
  const month = parseMonth((await searchParams).month) ?? monthOf(new Date(now));
  let exams: (ExamWithVersion & { college?: { id: string; name: string } })[];
  try {
    exams = await listExams(staff.tenantId);
  } catch (error) {
    return <LoadError error={error} />;
  }

  const scheduled = exams.flatMap(({ exam, version, college }) =>
    version && version.status !== "retired" ? [{ examId: exam.id, version, opensAt: version.opens_at, closesAt: version.closes_at, college }] : [],
  );
  const byDay = new Map<string, Entry[]>();
  for (const item of scheduled) {
    daysOfWindow(item.opensAt, item.closesAt).forEach((key, index) => {
      byDay.set(key, [...(byDay.get(key) ?? []), { ...item, first: index === 0 }].sort((a, b) => Date.parse(a.opensAt) - Date.parse(b.opensAt)));
    });
  }

  // Windows that share time: where labs and invigilators could be double-booked.
  // Two colleges' labs do not clash, so overlaps are looked for within each college.
  const clashes = [...Map.groupBy(scheduled, (item) => item.college?.id ?? "").values()]
    .flatMap((group) => overlappingPairs(group))
    .map(([a, b]) => ({ a, b, shared: sharedWindow(a, b) }))
    .filter(({ shared }) => daysOfWindow(shared.opensAt, shared.closesAt).some((key) => key.startsWith(month)));
  const clashDays = new Set(clashes.flatMap(({ shared }) => daysOfWindow(shared.opensAt, shared.closesAt)));

  const inMonth = scheduled.filter((item) => daysOfWindow(item.opensAt, item.closesAt).some((key) => key.startsWith(month)));
  const counts = (["live", "next", "draft", "closed"] as const).map((state) => ({ state, count: inMonth.filter((item) => examState(item.version, now) === state).length }));

  const clashRow = ({ a, b, shared }: (typeof clashes)[number]) => (
    <li key={`${a.examId}-${b.examId}`} className="py-2.5 first:pt-0 last:pb-0">
      <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-medium text-ink">
        <ExamPeek exam={{ exam: { id: a.examId }, version: a.version, college: a.college }} now={now} className="truncate transition-colors hover:text-brand">
          {a.version.title}
        </ExamPeek>
        <span className="font-mono text-[11px] text-ink-subtle">and</span>
        <ExamPeek exam={{ exam: { id: b.examId }, version: b.version, college: b.college }} now={now} className="truncate transition-colors hover:text-brand">
          {b.version.title}
        </ExamPeek>
      </p>
      <p className="mt-0.5 font-mono text-[11.5px] text-warning">
        {formatDateTime(shared.opensAt)} to {formatTime(shared.closesAt)}
      </p>
    </li>
  );

  return (
    <div className="animate-enter">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[12px] text-ink-subtle">Calendar / college time, {TIME_ZONE}</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.03em] text-ink">{monthName.format(new Date(`${month}-01T00:00:00Z`))}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="secondary" size="icon" aria-label="Previous month">
            <Link href={`/staff/calendar?month=${shiftMonth(month, -1)}`}>
              <CaretLeft />
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/staff/calendar">Today</Link>
          </Button>
          <Button asChild variant="secondary" size="icon" aria-label="Next month">
            <Link href={`/staff/calendar?month=${shiftMonth(month, 1)}`}>
              <CaretRight />
            </Link>
          </Button>
          <NewExamDialog />
        </div>
      </header>

      <div className="mt-7 grid gap-3 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-9">
          <div className="overflow-x-auto">
            <div className="min-w-[760px] overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
              <div className="grid grid-cols-7 bg-sidebar">
                {WEEKDAYS.map((weekday, index) => (
                  <div key={weekday} className={cn("px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle", index > 0 && "border-l border-line")}>
                    {weekday}
                  </div>
                ))}
              </div>
              {monthGrid(month).map((week) => (
                <div key={week[0]!.key} className="grid grid-cols-7 border-t border-line">
                  {week.map((day, column) => {
                    const entries = byDay.get(day.key) ?? [];
                    const isToday = day.key === today;
                    return (
                      <div
                        key={day.key}
                        className={cn("min-h-[8.5rem] p-1.5", column > 0 && "border-l border-line", !day.inMonth ? "bg-sidebar/60" : column > 4 && "bg-hover/30")}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span
                            className={cn(
                              "grid size-6 place-items-center rounded-full font-mono text-[12px] tabular-nums",
                              isToday ? "bg-brand font-semibold text-brand-ink" : day.inMonth ? "text-ink-muted" : "text-ink-subtle/60",
                            )}
                          >
                            {Number(day.key.slice(8))}
                          </span>
                          {clashDays.has(day.key) && (
                            <span className="text-warning">
                              <Warning className="size-3.5" aria-hidden />
                              <span className="sr-only">Overlapping exam windows on this day</span>
                            </span>
                          )}
                        </div>
                        <ul className="space-y-0.5">
                          {entries.slice(0, entries.length > CHIPS ? CHIPS : undefined).map((entry) => (
                            <li key={entry.examId}>
                              <Chip entry={entry} state={examState(entry.version, now)} now={now} />
                            </li>
                          ))}
                          {entries.length > CHIPS && (
                            <li>
                              <DayDialog dayKey={day.key} entries={entries} now={now} />
                            </li>
                          )}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[12px] text-ink-muted">
            {(["live", "next", "closed", "draft"] as const).map((state) => (
              <li key={state} className="flex items-center gap-2">
                <span aria-hidden className={cn("h-3.5 w-6 rounded-[4px]", CHIP[state])} />
                {STATE_NAME[state]}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 xl:col-span-3">
          <Tile label="This month">
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-control)] border border-line bg-line">
              {counts.map(({ state, count }) => (
                <div key={state} className="bg-surface px-3 py-2.5">
                  <dt className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">
                    {state === "live" && count > 0 && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-brand" />}
                    {STATE_NAME[state]}
                  </dt>
                  <dd className={cn("mt-1 text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums", state === "live" && count > 0 ? "text-brand" : "text-ink")}>{count}</dd>
                </div>
              ))}
            </dl>
          </Tile>

          <Tile
            label="Overlapping windows"
            expand={
              clashes.length > 4
                ? { title: "Overlapping windows", description: "Exams whose windows share time this month. Students sit within a window, so a lab is only double-booked if both are assigned to the same room.", content: <ul className="divide-y divide-line">{clashes.map(clashRow)}</ul> }
                : undefined
            }
          >
            {clashes.length === 0 ? (
              <p className="py-2 text-[13px] text-ink-muted">No two windows overlap in {monthName.format(new Date(`${month}-01T00:00:00Z`))}.</p>
            ) : (
              <ul className="divide-y divide-line">{clashes.slice(0, 4).map(clashRow)}</ul>
            )}
          </Tile>
        </div>
      </div>
    </div>
  );
}
