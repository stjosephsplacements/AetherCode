"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { isResetPath } from "@/lib/auth-paths";

/** The site-wide Google Analytics and Umami scripts. Never on the reset pages, whose address carries a bearer. */
export function PageAnalytics() {
  const pathname = usePathname();
  if (isResetPath(pathname)) return null;
  return (
    <>
      {/* Google Analytics (G-HQ6HC7XJL0) */}
      <Script src="https://www.googletagmanager.com/gtag/js?id=G-HQ6HC7XJL0" strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          // UUID segments (attempt, exam, student ids) never leave the browser.
          var redacted = window.location.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
          gtag('config', 'G-HQ6HC7XJL0', {
            page_path: redacted,
            page_location: window.location.origin + redacted,
            send_page_view: true
          });
        `}
      </Script>
      {/* Umami Self-Hosted Analytics */}
      <Script
        src="https://analytics-aethercode.stjosephsplacements.in/script.js"
        data-website-id="b476ff2a-f844-48b6-9bb2-1e9d0a68d001"
        strategy="afterInteractive"
      />
    </>
  );
}
