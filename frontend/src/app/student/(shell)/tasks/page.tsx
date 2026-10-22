import { Check, Circle, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { EmptyState } from "@/components/staff/page-header";
import { Panel } from "@/components/ui/card";
import type { PersonalTask } from "@/lib/api-types";
import { communityList } from "@/lib/server/community";
import { requireViewer } from "@/lib/server/session";
import { cn, formatDateTime, isOverdue } from "@/lib/utils";
import { addTask, deleteTask, toggleTask } from "../../community/actions";

export const metadata: Metadata = { title: "My tasks" };

export default async function TasksPage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const tasks = await communityList<PersonalTask>(viewer.tenantId, "tasks");
  return (
    <div className="animate-enter">
      <h1 className="display text-[2.25rem] text-ink sm:text-[2.6rem]">My tasks</h1>
      <p className="mt-2 max-w-[60ch] text-[15px] text-ink-muted">Your own to-do list: mock tests, applications, revision. Only you can see it.</p>
      <Panel className="mt-6 p-5">
        <ActionForm action={addTask} submitLabel="Add task">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Field label="Task" htmlFor="task-title">
              <TextInput id="task-title" name="title" maxLength={200} required />
            </Field>
            <Field label="Due (optional)" htmlFor="task-due">
              <TextInput id="task-due" name="due_date" type="date" />
            </Field>
          </div>
        </ActionForm>
      </Panel>
      <div className="mt-6">
        {tasks.length === 0 ? (
          <EmptyState>Nothing to do. Add something above.</EmptyState>
        ) : (
          <ul className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {tasks.map((task, index) => {
              const late = isOverdue(task.due_at, task.done);
              return (
                <li key={task.id} className={cn("flex items-center gap-3 px-4 py-3", index > 0 && "border-t border-line")}>
                  <form action={toggleTask}>
                    <input type="hidden" name="id" value={task.id} />
                    <input type="hidden" name="done" value={String(!task.done)} />
                    <button type="submit" aria-label={task.done ? "Mark as not done" : "Mark as done"} className="text-ink-muted hover:text-ink">
                      {task.done ? <Check className="size-5 text-success" strokeWidth={2} /> : <Circle className="size-5" strokeWidth={1.75} />}
                    </button>
                  </form>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[15px]", task.done ? "text-ink-subtle line-through" : "text-ink")}>{task.title}</p>
                    {task.due_at && <p className={cn("text-[12px]", late ? "text-danger" : "text-ink-muted")}>{late ? "Overdue, " : "Due "}{formatDateTime(task.due_at)}</p>}
                  </div>
                  <form action={deleteTask}>
                    <input type="hidden" name="id" value={task.id} />
                    <button type="submit" aria-label="Delete task" className="text-ink-subtle hover:text-danger">
                      <Trash2 className="size-4" strokeWidth={1.75} />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
