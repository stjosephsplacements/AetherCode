import { Flag } from "@phosphor-icons/react/ssr";
import { ExamPeek, examState } from "@/components/staff/exam-peek";
import { Table } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import { type Expand, Tile } from "@/components/staff/tile";
import type { AuditEntry, ExamVersion } from "@/lib/api-types";
import { auditAction } from "@/lib/audit";
import type { ExamWithVersion } from "@/lib/server/exams";
import { PASS_SHARE } from "@/lib/results";
import { TIME_ZONE, cn, formatDateTime, formatDuration, formatTime, formatWindow } from "@/lib/utils";

export type Scheduled = ExamWithVersion & { version: ExamVersion; college?: { id: string; name: string } };
/** Who is where in a live exam, from its monitor. */
export type Floor = { exam: Scheduled; waiting: number; writing: number; submitted: number; flags: number };
export type Outcome = { exam: Scheduled; attempts: number; average: number; pass: number };

export const DAY = 86_400_000;
export const DAYS = 7;

const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: TIME_ZONE });
const dayOfMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: TIME_ZONE });
const percent = (share: number) => `${Math.round(share * 100)}%`;

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

/** Our own hover and focus label for a chart mark; the browser's title tooltip is not used. */
function Tip({ label, children, className, style }: { label: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={cn("group/tip", className)} style={style}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md border border-line-strong bg-surface px-2 py-1 text-[12px] font-medium text-ink opacity-0 shadow-[var(--shadow-overlay)] transition-[opacity,transform] duration-150 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-focus-within/tip:translate-y-0 group-focus-within/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

const DOT = { good: "bg-success", warn: "bg-warning", bad: "bg-danger" };

/** A single number with a line of context. */
export function FigureTile({ label, value, note, tone, expand, className }: { label: string; value: string; note: string; tone?: keyof typeof DOT; expand?: Expand; className?: string }) {
  return (
    <Tile label={label} expand={expand} className={className}>
      <p className="mt-auto flex items-center gap-2.5 text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">
        {tone && <span aria-hidden className={cn("size-2 rounded-full", DOT[tone])} />}
        {value}
      </p>
      <p className="mt-2 truncate text-[12.5px] text-ink-muted">{note}</p>
    </Tile>
  );
}

function FloorBar({ floor }: { floor: Floor }) {
  const segments = [
    { key: "submitted", count: floor.submitted, label: "Submitted", fill: "bg-ink" },
    { key: "writing", count: floor.writing, label: "Writing", fill: "bg-brand" },
    { key: "waiting", count: floor.waiting, label: "Not started", fill: "bg-line-strong" },
  ];
  return (
    <>
      <div className="relative mt-2.5 flex h-2.5 gap-[2px]" role="img" aria-label={segments.map((segment) => `${segment.count} ${segment.label.toLowerCase()}`).join(", ")}>
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <Tip key={segment.key} label={`${segment.count} ${segment.label.toLowerCase()}`} className="relative h-full min-w-1" style={{ flex: `${segment.count} 1 0` }}>
              <span className={cn("block h-full w-full rounded-[4px]", segment.fill)} />
            </Tip>
          ))}
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-[2px]", segment.fill)} />
            {segment.label}
            <span className="font-mono tabular-nums text-ink">{segment.count}</span>
          </li>
        ))}
        <li className={cn("ml-auto flex items-center gap-1", floor.flags > 0 ? "text-warning" : "text-ink-subtle")}>
          <Flag className="size-3.5" />
          <span className="font-mono tabular-nums">{floor.flags}</span>
          <span className="sr-only">integrity flags</span>
        </li>
      </ul>
    </>
  );
}

function FloorList({ floors, now }: { floors: Floor[]; now: number }) {
  return (
    <ul className="space-y-4">
      {floors.map((floor) => (
        <li key={floor.exam.exam.id}>
          <div className="flex items-baseline justify-between gap-3">
            <ExamPeek exam={floor.exam} now={now} className="min-w-0 truncate text-sm font-semibold text-ink transition-colors hover:text-brand">
              {floor.exam.version.title}
            </ExamPeek>
            <span className="shrink-0 font-mono text-[11.5px] text-ink-muted">closes {formatTime(floor.exam.version.closes_at)}</span>
          </div>
          <FloorBar floor={floor} />
        </li>
      ))}
    </ul>
  );
}

/** The lead tile: how many are writing right now, and each open exam's floor. */
export function LiveTile({ floors, next, now, className }: { floors: Floor[]; next: Scheduled | undefined; now: number; className?: string }) {
  const writing = floors.reduce((sum, floor) => sum + floor.writing, 0);
  const submitted = floors.reduce((sum, floor) => sum + floor.submitted, 0);
  const live = floors.length > 0;
  return (
    <Tile
      label={live ? "Live now" : "Exam floor"}
      live={live}
      className={className}
      expand={live ? { title: "Live exams", description: "Every open exam, as its monitor sees it.", content: <FloorList floors={floors} now={now} /> } : undefined}
    >
      <p className={cn("text-[56px] font-semibold leading-none tracking-[-0.04em] tabular-nums", live ? "text-brand" : "text-ink")}>{writing}</p>
      <p className="mt-2 text-sm text-ink-muted">{live ? `writing in ${floors.length} live ${floors.length === 1 ? "exam" : "exams"}, ${submitted} submitted` : "writing now. No exam is open."}</p>
      <div className="mt-6 flex flex-1 flex-col justify-end">
        {live ? (
          <FloorList floors={floors.slice(0, 3)} now={now} />
        ) : next ? (
          <ExamPeek exam={next} now={now} className="block w-full rounded-[var(--radius-control)] border border-line px-4 py-3 transition-colors hover:border-line-strong hover:bg-hover">
            <span className="block font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">Next to open</span>
            <span className="mt-1 block truncate text-[15px] font-semibold text-ink">{next.version.title}</span>
            <span className="mt-0.5 block text-[13px] text-ink-muted">{formatDateTime(next.version.opens_at)}</span>
          </ExamPeek>
        ) : (
          <p className="text-[13px] text-ink-subtle">Nothing is scheduled. Publish an exam to see it here.</p>
        )}
      </div>
    </Tile>
  );
}

function TimelineChart({ start, now, exams }: { start: number; now: number; exams: Scheduled[] }) {
  const span = DAYS * DAY;
  const at = (time: number) => Math.min(100, Math.max(0, ((time - start) / span) * 100));
  const days = Array.from({ length: DAYS }, (_, index) => new Date(start + index * DAY + DAY / 2));
  return (
    <div className="relative [--label:108px] sm:[--label:180px]">
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[var(--label)] right-0 grid grid-cols-7">
        {days.map((day, index) => (
          <div key={index} className={cn("border-l border-line", index === 0 && "bg-hover/50")} />
        ))}
        <div className="absolute inset-y-0 w-px bg-brand" style={{ left: `${at(now)}%` }}>
          <span className="absolute -top-px left-1 rounded-sm bg-brand px-1 font-mono text-[10px] leading-4 text-brand-ink">now</span>
        </div>
      </div>
      <div className="relative grid grid-cols-[var(--label)_1fr] border-b border-line">
        <span />
        <div className="grid grid-cols-7">
          {days.map((day, index) => (
            <div key={index} className={cn("px-2 pb-2 font-mono text-[11px] uppercase", index === 0 ? "text-ink" : "text-ink-subtle")}>
              {weekday.format(day)} <span className="hidden sm:inline">{dayOfMonth.format(day)}</span>
            </div>
          ))}
        </div>
      </div>
      {exams.length === 0 ? (
        <p className="relative py-10 text-center text-sm text-ink-muted">No exam windows this week.</p>
      ) : (
        <ul className="relative">
          {exams.map((entry, index) => {
            const { version } = entry;
            const state = examState(version, now);
            const left = at(Date.parse(version.opens_at));
            return (
              <li key={entry.exam.id} className={cn("grid h-11 grid-cols-[var(--label)_1fr] items-center", index > 0 && "border-t border-line")}>
                <ExamPeek exam={entry} now={now} className="truncate pr-3 text-[13.5px] font-medium text-ink transition-colors hover:text-brand">
                  {version.title}
                </ExamPeek>
                <div className="relative h-full">
                  <Tip
                    label={`${formatDateTime(version.opens_at)} to ${formatTime(version.closes_at)}`}
                    className="absolute top-1/2 h-5 min-w-[6px] -translate-y-1/2"
                    style={{ left: `${left}%`, width: `${Math.max(at(Date.parse(version.closes_at)) - left, 0.8)}%` }}
                  >
                    <ExamPeek
                      exam={entry}
                      now={now}
                      label={`${version.title}, ${state === "live" ? "live now" : state === "closed" ? "closed" : "opens"} ${formatDateTime(version.opens_at)}`}
                      className={cn(
                        "block h-full w-full rounded-[4px] transition-[filter] hover:brightness-110",
                        state === "live" && "bg-brand",
                        state === "next" && "border border-line-strong bg-surface-2",
                        state === "closed" && "bg-line",
                      )}
                    >
                      <span className="sr-only">{version.title}</span>
                    </ExamPeek>
                  </Tip>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The week as a strip: one row per exam, its window as a bar, a line at now. */
export function TimelineTile({ start, now, exams, className }: { start: number; now: number; exams: Scheduled[]; className?: string }) {
  const shown = 5;
  return (
    <Tile
      label={`Exam windows, next ${DAYS} days`}
      className={className}
      expand={exams.length > shown ? { title: "Exam windows", description: `All ${exams.length} published exams over the next ${DAYS} days.`, content: <TimelineChart start={start} now={now} exams={exams} /> } : undefined}
    >
      <TimelineChart start={start} now={now} exams={exams.slice(0, shown)} />
      {exams.length > shown && <p className="mt-2 font-mono text-[11.5px] text-ink-subtle">+ {exams.length - shown} more, expand to see all</p>}
    </Tile>
  );
}

function ResultBars({ outcomes, now }: { outcomes: Outcome[]; now: number }) {
  return (
    <ul className="space-y-3">
      {outcomes.map(({ exam, attempts, average, pass }) => (
        <li key={exam.exam.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5">
          <ExamPeek exam={exam} now={now} className="truncate text-[13px] font-medium text-ink transition-colors hover:text-brand">
            {exam.version.title}
          </ExamPeek>
          <span className="font-mono text-[12.5px] tabular-nums text-ink">
            {percent(average)}
            <span className="ml-2 text-ink-subtle">{percent(pass)} pass</span>
          </span>
          <Tip label={`${percent(average)} average, ${percent(pass)} passed, ${attempts} graded`} className="relative col-span-2 block h-2.5">
            <span tabIndex={0} aria-label={`${exam.version.title}: ${percent(average)} average`} className="absolute inset-0 rounded-[4px] bg-hover outline-none">
              <span className="absolute inset-y-0 left-0 rounded-[4px] bg-brand" style={{ width: `${Math.max(average * 100, 1)}%` }} />
              <span aria-hidden className="absolute -inset-y-1 border-l border-dashed border-ink-muted" style={{ left: `${PASS_SHARE * 100}%` }} />
            </span>
          </Tip>
        </li>
      ))}
    </ul>
  );
}

/** Average score of the latest graded exams; the dashed line is the pass mark. */
export function ResultsTile({ outcomes, now, className }: { outcomes: Outcome[]; now: number; className?: string }) {
  return (
    <Tile
      label="Recent results"
      className={className}
      expand={
        outcomes.length
          ? {
              title: "Recent results",
              description: `The latest graded exams. Pass means at least ${percent(PASS_SHARE)} of the marks.`,
              content: (
                <Table head={["Exam", "Closed", "Graded", "Average", "Passed"]}>
                  {outcomes.map(({ exam, attempts, average, pass }) => (
                    <tr key={exam.exam.id}>
                      <td className="px-4 py-2.5">
                        <ExamPeek exam={exam} now={now} className="font-medium text-ink transition-colors hover:text-brand">
                          {exam.version.title}
                        </ExamPeek>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">{formatDateTime(exam.version.closes_at)}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-ink-muted">{attempts}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{percent(average)}</td>
                      <td className="px-4 py-2.5 font-mono tabular-nums text-ink">{percent(pass)}</td>
                    </tr>
                  ))}
                </Table>
              ),
            }
          : undefined
      }
    >
      {outcomes.length === 0 ? (
        <p className="my-auto py-6 text-center text-sm text-ink-muted">No graded exams yet. Results appear once an exam closes.</p>
      ) : (
        <>
          <ResultBars outcomes={outcomes.slice(0, 4)} now={now} />
          <p className="mt-auto flex items-center gap-2 pt-4 text-[11.5px] text-ink-subtle">
            <span aria-hidden className="h-3 border-l border-dashed border-ink-muted" />
            pass mark, {percent(PASS_SHARE)}
          </p>
        </>
      )}
    </Tile>
  );
}

function UpcomingList({ exams, now }: { exams: Scheduled[]; now: number }) {
  return (
    <ul className="-mx-2 space-y-0.5">
      {exams.map((entry) => (
        <li key={entry.exam.id}>
          <ExamPeek exam={entry} now={now} className="flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 transition-colors hover:bg-hover">
            <span className="grid w-9 shrink-0 text-center font-mono leading-tight">
              <span className="text-[10px] uppercase text-ink-subtle">{weekday.format(new Date(entry.version.opens_at))}</span>
              <span className="text-[16px] text-ink">{dayOfMonth.format(new Date(entry.version.opens_at))}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">{entry.version.title}</span>
              <span className="block truncate text-[12px] text-ink-muted">
                {formatTime(entry.version.opens_at)}, {formatDuration(entry.version.duration_seconds)}
              </span>
            </span>
          </ExamPeek>
        </li>
      ))}
    </ul>
  );
}

export function UpcomingTile({ exams, now, className }: { exams: Scheduled[]; now: number; className?: string }) {
  return (
    <Tile label="Coming up" className={className} expand={exams.length > 4 ? { title: "Coming up", description: "Published exams that have not opened yet.", content: <UpcomingList exams={exams} now={now} /> } : undefined}>
      {exams.length === 0 ? <p className="my-auto py-6 text-center text-sm text-ink-muted">Nothing scheduled.</p> : <UpcomingList exams={exams.slice(0, 4)} now={now} />}
    </Tile>
  );
}

function ActivityList({ entries, names, now }: { entries: AuditEntry[]; names: Map<string, { display_name?: string }>; now: number }) {
  return (
    <ol className="space-y-3">
      {entries.map((entry, index) => (
        <li key={`${entry.occurred_at}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-[13px]">
          <p className="min-w-0 truncate text-ink">
            <span className="font-medium">{names.get(entry.principal_id)?.display_name ?? "Unknown account"}</span>
            {!entry.allowed && <span className="ml-1.5 text-danger">refused</span>}
          </p>
          <span className="font-mono text-[11.5px] text-ink-subtle">{ago(entry.occurred_at, now)}</span>
          <p className="col-span-2 truncate text-[12.5px] text-ink-muted">{auditAction(entry)}</p>
        </li>
      ))}
    </ol>
  );
}

/** The latest staff changes, from the audit log. */
export function ActivityTile({ entries, names, now, className }: { entries: AuditEntry[]; names: Map<string, { display_name?: string }>; now: number; className?: string }) {
  return (
    <Tile
      label="Staff activity"
      className={className}
      expand={entries.length > 4 ? { title: "Staff activity", description: "The latest changes staff made in this college.", content: <ActivityList entries={entries} names={names} now={now} /> } : undefined}
    >
      {entries.length === 0 ? <p className="my-auto py-6 text-center text-sm text-ink-muted">No staff changes recorded yet.</p> : <ActivityList entries={entries.slice(0, 4)} names={names} now={now} />}
    </Tile>
  );
}

/** What the week tile expands to: every exam this week, by window. */
export function WeekDetail({ exams, now }: { exams: Scheduled[]; now: number }) {
  return exams.length === 0 ? (
    <p className="text-sm text-ink-muted">No exam windows this week.</p>
  ) : (
    <Table head={["Exam", "Window", "Duration", "State"]}>
      {exams.map((entry) => {
        const state = examState(entry.version, now);
        return (
          <tr key={entry.exam.id}>
            <td className="px-4 py-2.5">
              <ExamPeek exam={entry} now={now} className="font-medium text-ink transition-colors hover:text-brand">
                {entry.version.title}
              </ExamPeek>
            </td>
            <td className="px-4 py-2.5 text-ink-muted">{formatWindow(entry.version.opens_at, entry.version.closes_at)}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">{formatDuration(entry.version.duration_seconds)}</td>
            <td className="px-4 py-2.5">
              <Badge tone={state === "live" ? "brand" : state === "closed" ? "neutral" : "success"}>{state === "live" ? "Live" : state === "closed" ? "Closed" : "Scheduled"}</Badge>
            </td>
          </tr>
        );
      })}
    </Table>
  );
}
