"use client";

import { Camera } from "@phosphor-icons/react/ssr";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function WebcamConsent({ onConsent }: { onConsent: () => void }) {
  const [showMsg, setShowMsg] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="webcam-consent-title" className="fixed inset-0 z-50 grid place-items-center bg-canvas px-4">
      <div className="max-w-md text-center">
        <Camera className="mx-auto size-7 text-brand" />
        <h2 id="webcam-consent-title" className="display mt-4 text-[1.9rem] text-ink">Webcam monitoring</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          This exam requires webcam access. Periodic snapshots will be captured and reviewed by your institution for academic integrity purposes. No video is recorded continuously.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Button size="lg" onClick={onConsent}>I consent — start exam</Button>
          <Button variant="ghost" size="lg" onClick={() => setShowMsg(true)}>Contact your invigilator</Button>
        </div>
        {showMsg && (
          <p role="alert" className="mt-4 text-sm leading-relaxed text-ink-muted">
            Please speak to your invigilator to proceed without webcam access.
          </p>
        )}
      </div>
    </div>
  );
}
