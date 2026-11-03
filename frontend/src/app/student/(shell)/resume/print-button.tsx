"use client";

import { DownloadSimple } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="gap-2">
      <DownloadSimple className="size-4" />
      Print / Save PDF
    </Button>
  );
}
