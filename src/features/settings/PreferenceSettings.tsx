import clsx from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";
import { isThemePreference, type ThemePreference } from "../../app/theme";
import { Field } from "../../components/ui/Field";
import { Select } from "../../components/ui/Select";
import { setSetting, useSetting } from "../../db/settings";
import { COMMON_CURRENCIES, CURRENCY_KEY, useCurrency } from "./currency";

const THEME_KEY = "theme";

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function CurrencySetting() {
  const currency = useCurrency();
  const known = COMMON_CURRENCIES.some((c) => c.code === currency);
  return (
    <Field label="Currency" hint="Used as the default for new purchases. Nothing is converted.">
      <Select
        value={currency}
        onChange={(event) => void setSetting(CURRENCY_KEY, event.target.value)}
        className="max-w-sm"
      >
        {!known && <option value={currency}>{currency}</option>}
        {COMMON_CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} ({c.name})
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ThemeSetting() {
  const stored = useSetting<unknown>(THEME_KEY, "system");
  const theme: ThemePreference = isThemePreference(stored) ? stored : "system";
  const name = useId();
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">Theme</legend>
      <div className="mt-2 inline-flex flex-wrap gap-2">
        {THEMES.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={clsx(
              "inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              theme === value
                ? "border-primary bg-primary-soft text-primary"
                : "border-border-strong bg-surface text-ink hover:bg-surface-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={theme === value}
              onChange={() => void setSetting(THEME_KEY, value)}
              className="sr-only"
            />
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Currency and theme. */
export function PreferenceSettings() {
  return (
    <>
      <CurrencySetting />
      <ThemeSetting />
    </>
  );
}
