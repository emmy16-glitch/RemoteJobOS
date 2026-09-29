"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem("remotejobos-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = window.localStorage.getItem("remotejobos-theme") as Theme | null;
    const initial =
      saved === "light" || saved === "dark"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  return (
    <div className="themeToggle" aria-label="Appearance">
      <button
        type="button"
        className={theme === "light" ? "active" : ""}
        onClick={() => {
          setTheme("light");
          applyTheme("light");
        }}
        aria-pressed={theme === "light"}
      >
        <span aria-hidden="true">☼</span>
        Light
      </button>
      <button
        type="button"
        className={theme === "dark" ? "active" : ""}
        onClick={() => {
          setTheme("dark");
          applyTheme("dark");
        }}
        aria-pressed={theme === "dark"}
      >
        <span aria-hidden="true">☾</span>
        Dark
      </button>
    </div>
  );
}
