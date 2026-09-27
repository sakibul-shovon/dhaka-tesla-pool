import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

// The "content" template (history, wallet, admin — plan round 3 §2/§3):
// centred, capped width, consistent gutters. Workspace pages use
// Workspace.tsx instead; the marketing layout uses its own wider max-w-7xl.
export function PageContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12", className)}
      {...props}
    />
  );
}
