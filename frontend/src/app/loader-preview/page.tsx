import { LogoLoader } from "@/components/ui/logo-loader";

export default function LoaderPreviewPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-8 space-y-12">
      <div className="text-center space-y-2">
        <span className="eyebrow text-brand">ASSET PREVIEW</span>
        <h1 className="display text-3xl text-ink">Logo Loader</h1>
        <p className="text-sm text-ink-muted">Diagonal glossy reflection clipped directly to transparent logo mask</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-2xl">
        {/* Light Theme Panel */}
        <div className="flex flex-col items-center justify-center p-10 rounded-2xl border border-line bg-[#fbfbfd] shadow-sm space-y-4">
          <span className="text-xs font-mono font-medium text-neutral-500 uppercase">Light Theme (4.png)</span>
          <div className="p-8">
            <LogoLoader size={80} theme="light" />
          </div>
        </div>

        {/* Dark Theme Panel */}
        <div className="flex flex-col items-center justify-center p-10 rounded-2xl border border-neutral-800 bg-[#141419] shadow-sm space-y-4">
          <span className="text-xs font-mono font-medium text-neutral-400 uppercase">Dark Theme (3.png)</span>
          <div className="p-8">
            <LogoLoader size={80} theme="dark" />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <span className="text-xs font-mono text-ink-subtle uppercase">Auto-switching System Theme</span>
        <div className="p-6 rounded-xl border border-line bg-surface">
          <LogoLoader size={64} theme="auto" />
        </div>
      </div>
    </div>
  );
}
