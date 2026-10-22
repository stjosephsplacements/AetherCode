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
