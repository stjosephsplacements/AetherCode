"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="gap-2">
      <Download className="size-4" />
      Print / Save PDF
    </Button>
  );
}
