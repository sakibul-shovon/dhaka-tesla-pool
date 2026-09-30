import { Loader2 } from "lucide-react";

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <Loader2 size={size} strokeWidth={2.25} className={`animate-spin ${className}`} aria-hidden />;
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-text-faint">
      <Spinner size={22} />
    </div>
  );
}
