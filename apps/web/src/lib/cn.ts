import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Tailwind's own generated stylesheet order does NOT follow class-string
// order, so `` `p-4 ${className}` `` silently loses to a later `p-4` rule
// even when className="p-3" — found while auditing this exact bug across
// Card/Button/Skeleton. twMerge resolves same-property conflicts correctly
// (last one wins, by intent, not by accident of build output order).
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
