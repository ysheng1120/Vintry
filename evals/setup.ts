/**
 * Setup for the live AI eval suite (see vitest.eval.config.ts). Loads the fake IndexedDB
 * implementation so the app's Dexie database (src/db/db) works under Node/Vitest, exactly as
 * src/test/setup.ts does for the regular unit tests.
 */
import "fake-indexeddb/auto";
