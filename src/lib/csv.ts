import * as Papa from "papaparse";

/**
 * Decodes CSV/TSV bytes as strict UTF-8, falling back to windows-1252 (KTD13). CellarTracker and
 * other older exports are Latin-1/windows-1252; trying UTF-8 first keeps modern exports exact and
 * only falls back when the bytes are not valid UTF-8.
 */
export function decodeCsvBytes(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export interface ParsedCsv {
  headers: string[];
  /** One object per data row, keyed by header. A cell missing from a short row reads as "". */
  rows: Record<string, string>[];
  delimiter: string;
}

/** Parses CSV, semicolon, or tab-delimited text (KTD13); papaparse guesses the delimiter. */
export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(stripBom(text), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => value.trim(),
    delimitersToGuess: [",", ";", "\t", "|"],
  });
  const headers = result.meta.fields ?? [];
  const rows = result.data.map((row) => {
    const clean: Record<string, string> = {};
    for (const header of headers) clean[header] = row[header] ?? "";
    return clean;
  });
  return { headers, rows, delimiter: result.meta.delimiter || "," };
}

/** Decodes and parses a CSV file's raw bytes in one step. */
export function parseCsvFile(buffer: ArrayBuffer): ParsedCsv {
  return parseCsvText(decodeCsvBytes(buffer));
}

const CURRENCY_SYMBOLS = /[£$€¥₹]/g;

/**
 * Parses a number that may carry a currency symbol and use a comma or a dot as its decimal
 * separator (KTD13): "£12,50" -> 12.5, "1.234,56" -> 1234.56, "$1,234.56" -> 1234.56.
 * Returns null for blank or unreadable input.
 */
export function parseLocaleNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = raw
    .trim()
    .replace(CURRENCY_SYMBOLS, "")
    .replace(/[A-Za-z]/g, "")
    .trim();
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator comes last is the decimal point; the other is a thousands separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma !== -1) {
    const decimalDigits = s.length - lastComma - 1;
    const commaCount = s.split(",").length - 1;
    const looksDecimal = commaCount === 1 && decimalDigits > 0 && decimalDigits <= 2;
    s = looksDecimal ? s.replace(",", ".") : s.replace(/,/g, "");
  }

  const n = Number(s.replace(/\s+/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Builds CSV text from plain objects, in the given column order (KTD13's parser, Papa). */
export function unparseCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return Papa.unparse({
    fields: columns,
    data: rows.map((row) => columns.map((column) => row[column] ?? "")),
  });
}
