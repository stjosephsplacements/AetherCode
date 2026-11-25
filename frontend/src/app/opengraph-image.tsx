import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = `${SITE.name}: ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The card shared links unfurl into: the headline and one passing test run.
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "radial-gradient(800px 420px at 20% -10%, rgba(79,209,197,0.30), transparent 70%), radial-gradient(800px 420px at 90% 110%, rgba(179,176,255,0.22), transparent 70%), #0b1519",
          color: "#e8f1f0",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>{SITE.name}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 112, letterSpacing: -4, lineHeight: 1 }}>{SITE.tagline}</div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#9bb7b7", maxWidth: 900 }}>Calm, fair coding exams for colleges.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 24px",
              borderRadius: 999,
              background: "rgba(188,255,0,0.14)",
              color: "#bcff00",
              fontSize: 26,
              fontWeight: 600,
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#bcff00" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            5 of 5 test cases passed
          </div>
        </div>
      </div>
    ),
    size,
  );
}
