import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaContentBlockParam,
  BetaJSONOutputFormat,
  BetaMessage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { z } from "zod";
import { sendMessage, type Effort } from "./client";
import { AiError } from "./errors";

/** Part of the user's message: text, or a base64 image (already downscaled, KTD14). */
export type ContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      data: string;
    };

export interface StructuredRequest<Schema extends z.ZodType> {
  /** Feature name for usage totals, e.g. "scan". */
  feature: string;
  /** The result shape. The JSON schema sent to Claude is generated from it (KTD10). */
  schema: Schema;
  system: string;
  content: string | ContentPart[];
  effort?: Effort;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** JSON schema output format for a zod schema, in the shape structured outputs accept. */
export function outputFormatFor(schema: z.ZodType): BetaJSONOutputFormat {
  const format = betaZodOutputFormat(schema);
  // Keep only the wire fields; the helper also carries a parse function.
  return { type: format.type, schema: format.schema };
}

function toBlocks(content: string | ContentPart[]): string | BetaContentBlockParam[] {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", source: { type: "base64", media_type: part.mediaType, data: part.data } },
  );
}

function outputText(message: BetaMessage): string {
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

/**
 * One structured-output request that fills a draft (KTD10). Returns the zod-validated
 * object. Throws AiError: refusal, max-tokens, invalid-output, or a request error.
 * Usage is recorded even when the output is rejected.
 */
export async function runStructured<Schema extends z.ZodType>(
  request: StructuredRequest<Schema>,
): Promise<z.infer<Schema>> {
  const message = await sendMessage(
    {
      feature: request.feature,
      system: request.system,
      messages: [{ role: "user", content: toBlocks(request.content) }],
      effort: request.effort,
      maxTokens: request.maxTokens,
      outputFormat: outputFormatFor(request.schema),
    },
    { signal: request.signal },
  );

  // Check why the model stopped before reading any content.
  if (message.stop_reason === "refusal") throw new AiError("refusal");
  if (message.stop_reason === "max_tokens") throw new AiError("max-tokens");

  let json: unknown;
  try {
    json = JSON.parse(outputText(message));
  } catch (cause) {
    throw new AiError("invalid-output", { cause });
  }
  const parsed = request.schema.safeParse(json);
  if (!parsed.success) throw new AiError("invalid-output", { cause: parsed.error });
  return parsed.data;
}
