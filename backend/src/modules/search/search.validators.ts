import { z } from 'zod';

const dateTime = z.iso.datetime({ offset: true });
const tagFilter = z.string().trim().min(1).max(500).transform((value) =>
  [...new Set(value.split(',').map((tag) => tag.trim()))],
).refine((tags) => tags.length > 0 && tags.length <= 10 && tags.every((tag) => tag.length > 0 && tag.length <= 100));

export const searchQuerySchema = z.strictObject({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(2000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  domain: z.string().trim().min(1).max(253).optional(),
  tags: tagFilter.optional(),
  topic: z.string().trim().min(1).max(200).optional(),
  capture_type: z.enum(['text', 'url']).optional(),
  created_from: dateTime.optional(),
  created_to: dateTime.optional(),
  language: z.string().trim().min(1).max(100).optional(),
  is_code: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
}).refine((query) => !query.created_from || !query.created_to || query.created_from <= query.created_to, {
  path: ['created_to'],
  message: 'created_to must be on or after created_from',
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
