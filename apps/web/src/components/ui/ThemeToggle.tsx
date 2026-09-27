import { AnimatePresence, motion } from "motion/react";
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
      className={`relative flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-lg text-text-muted transition-colors hover:bg-surface-raised hover:text-text ${className ?? ""}`}
      aria-label={`Theme: ${LABELS[preference]}. Click to change.`}
      title={LABELS[preference]}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={preference}
          initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
          transition={{ duration: 0.18 }}
          className="flex"
        >
          <Icon size={17} strokeWidth={2.25} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
