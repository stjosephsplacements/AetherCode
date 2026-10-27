import { LogoLoader } from "@/components/ui/logo-loader";

export default function StudentLoading() {
  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <LogoLoader size={56} />
    </div>
  );
}
