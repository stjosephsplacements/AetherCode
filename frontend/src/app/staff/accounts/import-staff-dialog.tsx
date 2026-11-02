"use client";

import { Download, FileText, Upload, X } from "lucide-react";
import { useActionState, useMemo, useRef, useState } from "react";
import { CredentialsTable } from "@/components/staff/credentials";
import { Field, FormMessage, Select, SubmitButton, TextArea, initialActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { Department } from "@/lib/api-types";
import { MAX_STAFF_ROWS, parseStaffLines } from "@/lib/staff-csv";
import { cn } from "@/lib/utils";
import { type StaffImportState, importStaff } from "./actions";

export const STAFF_TEMPLATE = `username,full_name,email
meera.k,Dr. Meera Krishnan,meera@example.edu
ravi.s,Ravi Shankar,ravi.s@example.edu
ananya.p,Ananya Patel,`;

/** Add many staff from a drag-and-drop CSV or pasted text; they all get the same role and place. */
export function ImportStaffDialog({
  departments,
  colleges,
}: {
  departments: (Department & { collegeId: string; collegeName: string })[];
  colleges?: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<StaffImportState, FormData>(importStaff, initialActionState);
  const [role, setRole] = useState("department_user");
  const [college, setCollege] = useState(colleges?.[0]?.id ?? "");

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shown = colleges ? departments.filter((department) => department.collegeId === college) : departments;

  const { rows, problems } = useMemo(() => parseStaffLines(text), [text]);

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([STAFF_TEMPLATE], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "staff-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setFileError("File is too large. Please upload a CSV under 1 MB.");
      return;
    }
    const content = await file.text();
    setText(content);
    setFileName(file.name);
  }

  function handleReset() {
    setText("");
    setFileName("");
    setFileError(null);
    setShowManual(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Upload />
          Bulk import
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Bulk add staff"
        description="Add multiple staff members at once. Everyone in the file will receive the selected role and a temporary password."
        className="w-[min(94vw,680px)]"
      >
        <form action={action} className="min-h-0 space-y-4 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {colleges && (
              <Field label="College" htmlFor="bulk-staff-college">
                <Select id="bulk-staff-college" name="college_id" required value={college} onValueChange={setCollege}>
                  {colleges.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Role" htmlFor="bulk-staff-role">
              <Select id="bulk-staff-role" name="role" value={role} onValueChange={setRole}>
                <option value="department_user">Faculty</option>
                <option value="college_admin">College administrator</option>
              </Select>
            </Field>
            {role === "department_user" && (
              <Field label="Department" htmlFor="bulk-staff-department" className={colleges ? "sm:col-span-2" : undefined}>
                <Select id="bulk-staff-department" name="department_id" required>
                  {shown.map((department) => (
                    <option key={department.id} value={`${department.collegeId}:${department.id}`}>
                      {department.name} ({department.code})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          {/* Hidden input binding the text to the server action */}
          <input type="hidden" name="csv" value={text} />

          {/* Drag & Drop Upload Zone */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">Staff CSV File</span>
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline"
              >
                <Download className="size-3.5" />
                Download template
              </button>
            </div>

            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void loadFile(event.dataTransfer.files[0]);
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-surface)] border-2 border-dashed px-6 py-7 text-center transition-all",
                dragging
                  ? "border-brand bg-brand-soft/50 ring-4 ring-brand/15"
                  : "border-line-strong hover:border-brand/60 hover:bg-hover/40"
              )}
            >
              <div className="grid size-10 place-items-center rounded-full bg-surface shadow-[var(--shadow-hairline)] border border-line">
                <Upload className="size-5 text-brand" strokeWidth={2} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-ink">
                  {fileName ? (
                    <span className="inline-flex items-center gap-1.5 text-brand">
                      <FileText className="size-4" />
                      {fileName}
                    </span>
                  ) : (
                    "Click to upload or drag and drop CSV"
                  )}
                </p>
                <p className="text-xs text-ink-muted">
                  Columns: <code className="font-mono text-ink">username, full_name, email</code> (up to {MAX_STAFF_ROWS} rows)
                </p>
              </div>
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(event) => void loadFile(event.target.files?.[0])}
              />
            </label>

            {fileError && <p role="alert" className="text-xs text-danger">{fileError}</p>}

            {/* Validation & Status summary */}
            {text && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line bg-surface p-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <Badge tone={rows.length > 0 && problems.length === 0 ? "success" : "neutral"}>
                    {rows.length} valid {rows.length === 1 ? "staff" : "staff"}
                  </Badge>
                  {problems.length > 0 && <Badge tone="danger">{problems.length} errors</Badge>}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowManual((prev) => !prev)}
                    className="font-medium text-brand hover:underline"
                  >
                    {showManual ? "Hide manual editor" : "Edit / view raw text"}
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex items-center gap-1 text-ink-muted hover:text-danger"
                    title="Remove file"
                  >
                    <X className="size-3.5" />
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Manual text editor (optional collapsible) */}
            {showManual && (
              <Field
                label="Raw CSV Text"
                htmlFor="bulk-staff-manual"
                hint="Edit text directly if needed. Header row is optional."
              >
                <TextArea
                  ref={textareaRef}
                  id="bulk-staff-manual"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                  placeholder={STAFF_TEMPLATE}
                  className="min-h-32 font-mono text-xs"
                />
              </Field>
            )}

            {/* Parsing validation problems */}
            {problems.length > 0 && (
              <ul className="max-h-36 space-y-1 overflow-y-auto rounded-[var(--radius-control)] border border-danger/20 bg-danger-soft/40 p-3 text-xs text-danger">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </div>

          <FormMessage state={state} />

          <SubmitButton>
            {rows.length > 0 ? `Import ${rows.length} staff` : "Add staff"}
          </SubmitButton>

          {state.failed && state.failed.length > 0 && (
            <ul className="space-y-1 rounded-md border border-danger/20 bg-danger/5 p-3 text-[13px] text-danger">
              {state.failed.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}

          {state.created && state.created.length > 0 && (
            <div className="pt-2">
              <CredentialsTable filename="staff-passwords.csv" rows={state.created} />
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
