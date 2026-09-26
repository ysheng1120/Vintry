import { z } from "zod";
import {
  ChatMessageSchema,
  ChatThreadSchema,
  ConsumptionSchema,
  EventBatchSchema,
  LocationSchema,
  LotSchema,
  SettingRowSchema,
  TastingNoteSchema,
  WineSchema,
  WishlistItemSchema,
} from "../domain/types";

/**
 * Tables a backup carries (KTD15). `aiUsage` and `snapshots` stay on the device: they are never
 * exported and restore never replaces them. The "apiKey" setting is never exported either.
 */
export const BACKUP_TABLE_SCHEMAS = {
  wines: WineSchema,
  lots: LotSchema,
  consumptions: ConsumptionSchema,
  tastingNotes: TastingNoteSchema,
  locations: LocationSchema,
  wishlist: WishlistItemSchema,
  eventBatches: EventBatchSchema,
  chatThreads: ChatThreadSchema,
  chatMessages: ChatMessageSchema,
  settings: SettingRowSchema,
} as const;

export type BackupTableName = keyof typeof BACKUP_TABLE_SCHEMAS;
export const BACKUP_TABLES = Object.keys(BACKUP_TABLE_SCHEMAS) as BackupTableName[];

export const BackupDataSchema = z.object({
  wines: z.array(WineSchema),
  lots: z.array(LotSchema),
  consumptions: z.array(ConsumptionSchema),
  tastingNotes: z.array(TastingNoteSchema),
  locations: z.array(LocationSchema),
  wishlist: z.array(WishlistItemSchema),
  eventBatches: z.array(EventBatchSchema),
  chatThreads: z.array(ChatThreadSchema),
  chatMessages: z.array(ChatMessageSchema),
  settings: z.array(SettingRowSchema),
});
export type BackupData = z.infer<typeof BackupDataSchema>;

export const BackupFileSchema = z.object({
  app: z.literal("vintry"),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string(),
  data: BackupDataSchema,
});
export type BackupFile = z.infer<typeof BackupFileSchema>;

/** Setting keys that belong to this device only: never exported, kept across restore. */
export const DEVICE_ONLY_SETTING_KEYS: readonly string[] = ["apiKey"];
