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
  generator: "Next.js",
  applicationName: "Tailwind CSS",
  keywords: ["go", "golang", "git", "self-hosted", "gitea", "postgresql", "redis", "docker", "kubernetes"],
  other: {
    "next-size-adjust": "",
    "tech-stack": "Go, Python, Next.js, React, Tailwind CSS, Monaco Editor, PostgreSQL, Redis, Docker, Kubernetes, Nginx",
  },
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
