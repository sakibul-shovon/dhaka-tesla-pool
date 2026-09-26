import type { InputHTMLAttributes, ReactNode } from "react";

export function Input({
  icon,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint">{icon}</span>
      )}
      <input
        className={`w-full rounded-xl border border-border-strong bg-surface-raised py-2.5 text-sm text-text placeholder:text-text-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 ${icon ? "pl-9 pr-3" : "px-3"} ${className}`}
        {...props}
      />
    </div>
  );
}
