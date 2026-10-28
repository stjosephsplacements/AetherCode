import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ConsentManager } from "@/components/site/consent";
import { readTheme } from "@/lib/server/theme";
import { SITE } from "@/lib/site";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

function origin(): URL | undefined {
  try {
    return new URL(process.env.PUBLIC_ORIGIN ?? "");
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: origin(),
  title: { default: `${SITE.name}: ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  // Everything behind sign-in stays out of search; the public pages opt back in.
  robots: { index: false, follow: false },
  openGraph: { type: "website", siteName: SITE.name, locale: "en_IN", title: `${SITE.name}: ${SITE.tagline}`, description: SITE.description },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0b1e" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendered on the server from the viewer's cookie, so there is no theme flash.
  const theme = await readTheme();
  return (
    // The font variables sit on <html> because the theme's --font-* tokens are
    // declared on :root and resolve there.
    <html lang="en" data-theme={theme} className={`${geist.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        {children}
        <ConsentManager />
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
