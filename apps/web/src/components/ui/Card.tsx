import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-border bg-surface p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] ${className}`}
      {...props}
    />
  );
}
