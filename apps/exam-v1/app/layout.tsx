import type { Metadata } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { fromSebBrowser } from "@/lib/seb";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const heading = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-heading" });
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
    <html lang="en" className={`${manrope.variable} ${heading.variable} ${mono.variable}`} suppressHydrationWarning data-seb={insideSeb ? "" : undefined}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
