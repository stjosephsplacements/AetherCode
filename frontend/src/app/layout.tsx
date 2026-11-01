import Script from "next/script";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: "AetherCode", template: "%s · AetherCode" },
  description: "Coding exams for colleges.",
  icons: { icon: "/logo.png" },
  robots: { index: false, follow: false },
  applicationName: "AetherCode",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
    { media: "(prefers-color-scheme: dark)", color: "#262624" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The font variables sit on <html> because the theme's --font-* tokens are
    // declared on :root and resolve there.
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${sourceSerif.variable}`}>
      <body className="antialiased">
        {/* Google Analytics (G-HQ6HC7XJL0) */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-HQ6HC7XJL0"
          strategy="afterInteractive"
        />
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
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            className: "!rounded-[10px] !border-line !bg-surface !text-ink !shadow-[var(--shadow-overlay)] !font-sans",
          }}
        />
      </body>
    </html>
  );
}
