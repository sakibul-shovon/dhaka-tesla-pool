import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && (
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-accent-strong">
          {eyebrow}
        </p>
      )}
      <h2 className="mt-2 text-balance font-display text-2xl font-bold text-text sm:text-3xl">
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-base leading-relaxed text-text-muted">{description}</p>
      )}
    </div>
  );
}
