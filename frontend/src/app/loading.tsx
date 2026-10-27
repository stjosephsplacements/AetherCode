import { LogoLoader } from "@/components/ui/logo-loader";

export default function Loading() {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center">
      <LogoLoader size={64} />
    </div>
  );
}
