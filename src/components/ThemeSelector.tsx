"use client";
import { useEffect, useState } from "react";
import { COPY } from "@/game/copy";
export const THEMES = [
  "original",
  "light",
  "dark",
  "coffee",
  "vibrant",
] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_KEY = "goobers-theme";
export default function ThemeSelector() {
  const [theme, setTheme] = useState<Theme>("original");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (THEMES.includes(saved as Theme)) {
        setTheme(saved as Theme);
        document.documentElement.dataset.theme = saved!;
      }
    } catch {}
  }, []);
  function choose(value: Theme) {
    setTheme(value);
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {}
  }
  return (
    <label className="theme-selector">
      <span>{COPY.themes.label}</span>
      <select
        aria-label={COPY.themes.label}
        value={theme}
        onChange={(e) => choose(e.target.value as Theme)}
      >
        {THEMES.map((t) => (
          <option key={t} value={t}>
            {COPY.themes[t]}
          </option>
        ))}
      </select>
    </label>
  );
}
