import type { ReactNode } from "react";

type Tone = "accent" | "success" | "warning" | "danger" | "neutral" | "electric";

const TONE_CLASSES: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent-strong",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-raised text-text-muted",
  electric: "bg-electric-soft text-electric",
};

export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {icon}
      {children}
    </span>
  );
}
