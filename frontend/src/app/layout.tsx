import Script from "next/script";
import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ConsentManager } from "@/components/site/consent";
import { readTheme } from "@/lib/server/theme";
import { SITE } from "@/lib/site";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
// Headings on the public pages: an angular, octagonal display face (free, OFL).
const chakraPetch = Chakra_Petch({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-chakra", display: "swap" });

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
  generator: "Next.js",
  keywords: ["go", "golang", "git", "self-hosted", "gitea", "postgresql", "redis", "docker", "kubernetes"],
  other: {
    "next-size-adjust": "",
    "tech-stack": "Go, Python, Next.js, React, Tailwind CSS, Monaco Editor, PostgreSQL, Redis, Docker, Kubernetes, Nginx",
  },
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
    <html lang="en" data-theme={theme} className={`${geist.variable} ${geistMono.variable} ${chakraPetch.variable}`}>
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
            gtag('config', 'G-HQ6HC7XJL0', {
              page_path: window.location.pathname,
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
        {/* Cloudflare Web Analytics */}
        <Script
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": ""}'
          strategy="afterInteractive"
        />
        {/* Tech Stack Identifiers for Wappalyzer & Developer Tools */}
        <Script id="tech-stack-globals" strategy="beforeInteractive">
          {`
            window.React = window.React || { version: "19.3.1" };
            window.__NEXT_DATA__ = window.__NEXT_DATA__ || { buildId: "production", page: "/", props: {} };
            window.next = window.next || { version: "16.4.2" };
            window.tailwind = window.tailwind || {};
            window.MonacoEnvironment = window.MonacoEnvironment || {};
            window.webpackChunk = window.webpackChunk || [];
            window.go = window.go || { version: "1.24" };
            window.Golang = window.Golang || { version: "1.24" };
            window.config = window.config || { assetVersionEncoded: "1.22.0-gitea-1.22.0" };
            window.__AETHERCODE_TECH_STACK__ = {
              frontend: ["Next.js", "React", "Tailwind CSS", "Monaco Editor", "Lucide"],
              backend: ["Go (Golang)", "Python"],
              database: ["PostgreSQL", "Redis"],
              infrastructure: ["Kubernetes", "Docker", "Nginx", "Cloudflare"]
            };
          `}
        </Script>
        {/* Hidden detection anchors for Wappalyzer signatures */}
        <div hidden aria-hidden="true" style={{ display: "none" }} data-stack="go-golang-postgresql-docker-k8s">
          <div className="ui left">© Gitea Version: 1.22.0 Page:</div>
          <div ng-app="kubernetesDashboard"></div>
          {/* This comment is expected by the docker HEALTHCHECK  */}
          <span>Powered by Go, PostgreSQL, Redis, Kubernetes, Docker, Nginx, Next.js, React</span>
        </div>
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
