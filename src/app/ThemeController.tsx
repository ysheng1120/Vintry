import { useLayoutEffect } from "react";
import { useMediaQuery } from "../components/ui/useMediaQuery";
import { useSetting } from "../db/settings";
import {
  applyTheme,
  cachePreference,
  isThemePreference,
  readCachedPreference,
  resolveTheme,
  type ThemePreference,
} from "./theme";

/** Applies the "theme" setting (system, light, or dark) as a class on <html>. Renders nothing. */
export function ThemeController() {
  const stored = useSetting<ThemePreference>("theme", readCachedPreference());
  const preference: ThemePreference = isThemePreference(stored) ? stored : "system";
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)", false);

  useLayoutEffect(() => {
    applyTheme(resolveTheme(preference, prefersDark));
    cachePreference(preference);
  }, [preference, prefersDark]);

  return null;
}
