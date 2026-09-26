// Contract stub owned by U7 (AI foundation). U7 replaces the body; keep the exported shape.
// U10's import flow calls suggestCsvMapping for generic CSV files when a key is set.

/** Vintry fields a CSV column can map to. */
export type ImportField =
  | "producer"
  | "name"
  | "vintage"
  | "colour"
  | "country"
  | "region"
  | "appellation"
  | "grapes"
  | "bottleSize"
  | "quantity"
  | "location"
  | "bin"
  | "purchaseDate"
  | "pricePerBottle"
  | "currency"
  | "store"
  | "windowFrom"
  | "windowTo"
  | "rating"
  | "notes";

export type CsvMapping = Partial<Record<ImportField, string>>; // field -> CSV header

export interface CsvMappingSuggestion {
  mapping: CsvMapping;
  /** Plain-language notes, e.g. "Colour column uses 'Rouge' for red". */
  notes: string[];
}

export async function suggestCsvMapping(
  headers: string[],
  sampleRows: string[][],
): Promise<CsvMappingSuggestion> {
  void headers;
  void sampleRows;
  throw new Error("AI mapping is not available yet.");
}
