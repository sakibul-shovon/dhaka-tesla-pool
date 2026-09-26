import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent text-on-accent hover:brightness-95 active:brightness-90 disabled:opacity-50 disabled:hover:brightness-100",
  secondary:
    "border border-border-strong bg-surface-raised text-text hover:border-accent hover:text-accent-strong disabled:opacity-40",
  ghost: "text-text-muted hover:bg-surface-raised hover:text-text disabled:opacity-40",
  danger:
    "border border-danger/35 bg-danger-soft/40 text-danger hover:bg-danger-soft disabled:opacity-50",
};

export function Button({
  variant = "primary",
  icon,
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
