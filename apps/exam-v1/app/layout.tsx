import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { fromSebBrowser } from "@/lib/seb";

const satoshi = localFont({
  src: [
    { path: "../public/fonts/satoshi-300.woff2", weight: "300", style: "normal" },
    { path: "../public/fonts/satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "../public/fonts/satoshi-700.woff2", weight: "700", style: "normal" },
    { path: "../public/fonts/satoshi-900.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "AetherCode",
  description: "Coding assessments for campus.",
};

// Runs before first paint so the page never flashes the wrong theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Inside SEB, pages keep clear of its taskbar (see :root[data-seb] in globals.css).
  const insideSeb = fromSebBrowser(await headers());
  return (
    <html lang="en" className={`${satoshi.variable} ${mono.variable}`} suppressHydrationWarning data-seb={insideSeb ? "" : undefined}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
