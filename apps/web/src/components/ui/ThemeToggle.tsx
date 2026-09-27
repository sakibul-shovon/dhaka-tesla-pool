import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "../../app/theme.js";

const ORDER: ThemePreference[] = ["system", "light", "dark"];
const ICONS = { system: Monitor, light: Sun, dark: Moon };
const LABELS = { system: "System theme", light: "Light theme", dark: "Dark theme" };

export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  const Icon = ICONS[preference];

  return (
    <button
      type="button"
      onClick={() =>
        setPreference(ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length] ?? "system")
      }
      className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-raised hover:text-text ${className ?? ""}`}
      aria-label={`Theme: ${LABELS[preference]}. Click to change.`}
      title={LABELS[preference]}
    >
      <Icon size={17} strokeWidth={2.25} />
    </button>
  );
}
