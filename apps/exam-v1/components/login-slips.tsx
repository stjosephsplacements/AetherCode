"use client";

import type { Credential } from "@/app/admin/actions";

// Three columns of cut-out cards; 21 fit on an A4 page.
export function LoginSlips({ credentials }: { credentials: Credential[] }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="print-only">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
        {credentials.map((entry) => (
          <div
            key={entry.username}
            style={{ border: "1px dashed #999", padding: "3mm 4mm", height: "38mm", breakInside: "avoid", fontFamily: "sans-serif", color: "#000" }}
          >
            <div style={{ fontSize: "8pt", fontWeight: 700, letterSpacing: "0.04em" }}>AETHERCODE EXAM LOGIN</div>
            <div style={{ fontSize: "10pt", fontWeight: 600, marginTop: "1.5mm", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {entry.name}
            </div>
            <div style={{ fontSize: "8pt" }}>{entry.batch ?? ""}</div>
            <div style={{ fontSize: "9pt", marginTop: "1.5mm" }}>
              Username: <strong>{entry.username}</strong>
            </div>
            <div style={{ fontSize: "9pt" }}>
              Password: <strong style={{ fontFamily: "monospace", fontSize: "11pt" }}>{entry.password}</strong>
            </div>
            <div style={{ fontSize: "7pt", marginTop: "1mm" }}>{origin} · keep this private</div>
          </div>
        ))}
      </div>
    </div>
  );
}
