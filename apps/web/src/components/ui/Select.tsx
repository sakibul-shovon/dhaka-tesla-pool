import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

export function Select({
  icon,
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { icon?: ReactNode }) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint">{icon}</span>
      )}
      <select
        className={`w-full appearance-none rounded-xl border border-border-strong bg-surface-raised py-2.5 pr-9 text-sm text-text transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 ${icon ? "pl-9" : "pl-3"} ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        strokeWidth={2}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-faint"
      />
    </div>
  );
}
