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
          background: "radial-gradient(800px 420px at 20% -10%, rgba(5,199,112,0.22), transparent 70%), radial-gradient(800px 420px at 90% 110%, rgba(115,211,251,0.22), transparent 70%), #fafafa",
          color: "#0e141e",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>{SITE.name}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 112, letterSpacing: -4, lineHeight: 1 }}>{SITE.tagline}</div>
          <div style={{ marginTop: 28, fontSize: 30, color: "#576871", maxWidth: 900 }}>Open-source coding assessments for colleges.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 24px",
              borderRadius: 999,
              background: "#0e141e",
              color: "#05c770",
              fontSize: 26,
              fontWeight: 600,
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#05c770" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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
