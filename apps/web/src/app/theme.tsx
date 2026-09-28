import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePreference = "system" | "light" | "dark";
const STORAGE_KEY = "dtp-theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(pref: ThemePreference): boolean {
  const isDark = pref === "dark" || (pref === "system" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", isDark);
  return isDark;
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage can throw (private browsing, blocked storage) — light is still the default.
  }
  // Light is the deliberate default (ADR-017), not the OS preference — a
  // first-time visitor on a dark-mode OS should still see the light theme
  // this product was designed around, and switch to dark explicitly.
  return "light";
}

interface ThemeContextValue {
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  resolvedDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// index.html's inline script already applied the right class before first
// paint (no flash) — this provider just keeps React and the DOM in sync
// afterward, and reacts to the OS setting changing while "system" is active.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [resolvedDark, setResolvedDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  function setPreference(pref: ThemePreference) {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Best-effort persistence only; the toggle still works for this page view.
    }
  }

  useEffect(() => {
    // A real "synchronize with an external system" effect (applying a DOM
    // class, subscribing to the OS's own MediaQueryList) — not a derived-
    // state case with a render-time fix, so the setState here is correct,
    // not a smell the lint rule can tell apart from one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolvedDark(applyTheme(preference));
    if (preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setResolvedDark(applyTheme("system"));
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, [preference]);

  return (
    <ThemeContext.Provider value={{ preference, setPreference, resolvedDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
