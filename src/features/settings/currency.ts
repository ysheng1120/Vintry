import { useSetting } from "../../db/settings";

/** Same string as CURRENCY_KEY in src/db/settings. */
export const CURRENCY_KEY = "currency";

/** Currencies offered in Settings, most common for wine buyers first. */
export const COMMON_CURRENCIES = [
  { code: "USD", name: "US dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "CHF", name: "Swiss franc" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "AUD", name: "Australian dollar" },
  { code: "NZD", name: "New Zealand dollar" },
  { code: "JPY", name: "Japanese yen" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "HKD", name: "Hong Kong dollar" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "KRW", name: "South Korean won" },
  { code: "INR", name: "Indian rupee" },
  { code: "SEK", name: "Swedish krona" },
  { code: "NOK", name: "Norwegian krone" },
  { code: "DKK", name: "Danish krone" },
  { code: "PLN", name: "Polish złoty" },
  { code: "CZK", name: "Czech koruna" },
  { code: "ZAR", name: "South African rand" },
  { code: "BRL", name: "Brazilian real" },
  { code: "MXN", name: "Mexican peso" },
  { code: "ARS", name: "Argentine peso" },
  { code: "CLP", name: "Chilean peso" },
] as const;

export type CurrencyCode = (typeof COMMON_CURRENCIES)[number]["code"];

const EURO_REGIONS = [
  "AD",
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MC",
  "ME",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
  "SM",
  "VA",
];

const REGION_CURRENCY: Record<string, CurrencyCode> = {
  ...Object.fromEntries(EURO_REGIONS.map((region) => [region, "EUR" as const])),
  US: "USD",
  GB: "GBP",
  CH: "CHF",
  LI: "CHF",
  CA: "CAD",
  AU: "AUD",
  NZ: "NZD",
  JP: "JPY",
  CN: "CNY",
  HK: "HKD",
  SG: "SGD",
  KR: "KRW",
  IN: "INR",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  ZA: "ZAR",
  BR: "BRL",
  MX: "MXN",
  AR: "ARS",
  CL: "CLP",
};

/** The usual currency for a locale such as "en-GB", or USD when the region is unknown. */
export function currencyForLocale(locale: string): CurrencyCode {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return (region && REGION_CURRENCY[region]) || "USD";
  } catch {
    return "USD";
  }
}

export function browserLocale(): string {
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
}

/** The collector's currency: the saved setting, or the browser locale's currency. */
export function useCurrency(): string {
  return useSetting<string>(CURRENCY_KEY, currencyForLocale(browserLocale()));
}
