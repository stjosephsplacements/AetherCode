"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Checklist, type ChecklistStep } from "./checklist";

/** Opens on the dashboard until the basics exist, or until the admin dismisses it. */
export function GetStarted({ steps, userId }: { steps: ChecklistStep[]; userId: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const key = `ac-setup-dismissed:${userId}`;
  const incomplete = steps.some((step) => !step.done);
  useEffect(() => {
    if (!incomplete || pathname !== "/staff" || localStorage.getItem(key)) return;
    const timer = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(timer);
  }, [incomplete, pathname, key]);
  const dismiss = (forever: boolean) => {
    if (forever) localStorage.setItem(key, "1");
    setOpen(false);
  };
  const doneCount = steps.filter((step) => step.done).length;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss(false))}>
      <DialogContent title="Get started" description={`${doneCount} of ${steps.length} done. Each step unlocks the next.`}>
        <div className="overflow-y-auto px-6 py-5">
          <Checklist steps={steps} onNavigate={() => setOpen(false)} />
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-3">
          <Link href="/staff/help" onClick={() => setOpen(false)} className="text-[13px] text-brand hover:underline">
            How the platform works
          </Link>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => dismiss(true)}>
              Don&apos;t show again
            </Button>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Later
              </Button>
            </DialogClose>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
