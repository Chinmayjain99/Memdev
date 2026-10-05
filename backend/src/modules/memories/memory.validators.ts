import { z } from 'zod';
import type { PageCursor } from './memory.types.js';

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const nullableNonBlankText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const url = z.string().url().refine((value) => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}, 'URL must use HTTP or HTTPS');
const tags = z.array(z.string().trim().min(1).max(100)).max(100).optional();
const metadata = {
  title: nullableNonBlankText(500),
  manualNote: nullableText(20_000),
  sourceUrl: url.nullable().optional(),
  pageTitle: nullableText(1000),
  domain: nullableText(253),
  tags,
  topic: nullableText(200),
  language: nullableText(100),
  isCode: z.boolean().optional(),
  codeLanguage: nullableText(100),
  clientCreatedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
};

const textMemorySchema = z.strictObject({
  ...metadata,
  captureType: z.literal('text'),
  selectedText: z.string().trim().min(1).max(100_000),
});
const urlMemorySchema = z.strictObject({
  ...metadata,
  captureType: z.literal('url'),
  sourceUrl: url,
  selectedText: z.string().trim().min(1).max(100_000).nullable().optional(),
});

export const createMemorySchema = z.discriminatedUnion('captureType', [textMemorySchema, urlMemorySchema])
  .superRefine((value, context) => {
    if (value.codeLanguage && value.isCode !== true) {
      context.addIssue({ code: 'custom', path: ['codeLanguage'], message: 'Set isCode to true when specifying codeLanguage' });
    }
  });

export const updateMemorySchema = z.strictObject({
  title: nullableNonBlankText(500),
  manualNote: nullableText(20_000),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  topic: nullableText(200),
  language: nullableText(100),
  pageTitle: nullableText(1000),
  domain: nullableText(253),
  isCode: z.boolean().optional(),
  codeLanguage: nullableText(100),
}).refine((value) => Object.keys(value).length > 0, 'At least one editable field is required')
  .superRefine((value, context) => {
    if (value.isCode === false && value.codeLanguage != null) {
      context.addIssue({ code: 'custom', path: ['codeLanguage'], message: 'codeLanguage must be cleared when isCode is false' });
    }
  });

export const listMemoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});

const cursorSchema = z.strictObject({ createdAt: z.iso.datetime({ precision: 6 }), id: z.string().uuid() });

export function decodePageCursor(value: string): PageCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const cursor = cursorSchema.parse(parsed);
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch {
    return null;
  }
}

export function encodePageCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;
