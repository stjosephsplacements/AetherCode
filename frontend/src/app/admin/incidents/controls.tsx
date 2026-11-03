"use client";

import { Megaphone, Timer } from "@phosphor-icons/react/ssr";
import { type ReactNode, useState } from "react";
import { ActionForm, Field, TextArea, TextInput } from "@/components/staff/form";
import type { ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { announceExam, extendExam } from "./actions";

function ControlDialog({ icon, label, title, description, submitLabel, action, tenantId, versionId, children }: { icon: ReactNode; label: string; title: string; description: string; submitLabel: string; action: (previous: ActionState, form: FormData) => Promise<ActionState>; tenantId: string; versionId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          {icon}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description} className="w-[min(92vw,520px)]">
        <div className="min-h-0 overflow-y-auto p-6">
          <ActionForm action={action} submitLabel={submitLabel} onSuccess={() => setOpen(false)}>
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="exam_version_id" value={versionId} />
            {children}
          </ActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The two emergency controls for one open exam. Both are recorded in the audit log by the services. */
export function ExamControls({ tenantId, versionId, title }: { tenantId: string; versionId: string; title: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <ControlDialog icon={<Timer />} label="Add time" title={`Add time: ${title}`} description="Added to every attempt still in progress, for example after a lab outage." submitLabel="Add time" action={extendExam} tenantId={tenantId} versionId={versionId}>
        <Field label="Minutes" htmlFor={`extend-${versionId}`}>
          <TextInput id={`extend-${versionId}`} name="minutes" type="number" min={1} max={240} defaultValue={10} required />
        </Field>
      </ControlDialog>
      <ControlDialog icon={<Megaphone />} label="Announce" title={`Announce: ${title}`} description="Shown on every open exam screen of this exam." submitLabel="Send to everyone" action={announceExam} tenantId={tenantId} versionId={versionId}>
        <Field label="Message" htmlFor={`announce-${versionId}`}>
          <TextArea id={`announce-${versionId}`} name="body" maxLength={2000} required className="min-h-20" />
        </Field>
      </ControlDialog>
    </div>
  );
}
