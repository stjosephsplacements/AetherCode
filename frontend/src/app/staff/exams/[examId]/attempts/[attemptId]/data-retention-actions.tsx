"use client";

import type { ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TextInput } from "@/components/staff/form";
import { api } from "@/lib/client/api";
import { toast } from "sonner";

export function DataRetentionActions({
  tenantId,
  examId,
  attemptId,
  canHardDelete,
}: {
  tenantId: string;
  examId: string;
  attemptId: string;
  canHardDelete: boolean;
}) {
  const router = useRouter();
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function purgeRuns() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ purged_runs: number; purged_units: number }>(
        `/submission/v1/tenants/${tenantId}/attempts/${attemptId}/code-runs/purge`,
        { method: "POST", body: JSON.stringify({ reason: reason.trim() }) },
      );
      toast.success(`Purged ${result.purged_runs} run(s) and ${result.purged_units} unit row(s).`);
      setPurgeOpen(false);
      setReason("");
    } catch {
      toast.error("Could not purge code runs.");
    } finally {
      setBusy(false);
    }
  }

  async function hardDelete() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await api(`/submission/v1/tenants/${tenantId}/attempts/${attemptId}/hard`, {
        method: "DELETE",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      toast.success("Attempt permanently deleted.");
      setDeleteOpen(false);
      router.push(`/staff/exams/${examId}/monitor`);
      router.refresh();
    } catch {
      toast.error("Hard delete was denied or the attempt is under legal hold.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 flex flex-wrap gap-3 border-t border-line pt-6">
      <Button variant="secondary" onClick={() => setPurgeOpen(true)}>
        Purge code runs
      </Button>
      {canHardDelete && (
        <Button variant="secondary" className="border-danger/40 text-danger hover:bg-danger-soft" onClick={() => setDeleteOpen(true)}>
          Permanently delete attempt
        </Button>
      )}

      <ReasonDialog
        open={purgeOpen}
        title="Purge code runs"
        description="Deletes ephemeral Run-code rows for this attempt. Grading evidence is not removed."
        reason={reason}
        onReason={setReason}
        busy={busy}
        onClose={() => setPurgeOpen(false)}
        onConfirm={purgeRuns}
      />
      {canHardDelete && (
        <ReasonDialog
          open={deleteOpen}
          title="Permanently delete attempt"
          description="This cannot be undone. Legal holds block deletion."
          reason={reason}
          onReason={setReason}
          busy={busy}
          onClose={() => setDeleteOpen(false)}
          onConfirm={hardDelete}
          destructive
        />
      )}
    </div>
  );
}

function ReasonDialog({
  open,
  title,
  description,
  reason,
  onReason,
  busy,
  onClose,
  onConfirm,
  destructive,
}: {
  open: boolean;
  title: string;
  description: string;
  reason: string;
  onReason: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent title={title} description={description} className="p-6">
        <TextInput
          value={reason}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onReason(event.target.value)}
          placeholder="Reason for audit log"
          maxLength={500}
          className="mt-3 w-full"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "secondary" : "primary"}
            className={destructive ? "border-danger/40 text-danger hover:bg-danger-soft" : undefined}
            disabled={busy || !reason.trim()}
            onClick={onConfirm}
          >
            Confirm
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}