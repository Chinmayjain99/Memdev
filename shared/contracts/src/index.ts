import { z } from 'zod';

const uuid = z.string().uuid();
const timestamp = z.iso.datetime({ offset: true });
const positiveVersion = z.number().int().positive();
export type ContractSchema<T> = z.ZodType<T>;

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

export const publicUserSchema = z.object({
  id: uuid,
  email: z.string().nullable(),
  displayName: z.string().nullable(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authResponseSchema = z.object({
  user: publicUserSchema,
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
export const authMeResponseSchema = z.object({ user: publicUserSchema });
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

export type AuthRequest = { email: string; password: string };
export type RegisterRequest = AuthRequest & { displayName?: string };

export const captureTypeSchema = z.enum(['text', 'url']);
export type CaptureType = z.infer<typeof captureTypeSchema>;

export const memorySchema = z.object({
  id: uuid,
  captureType: captureTypeSchema,
  title: z.string().nullable(),
  selectedText: z.string().nullable(),
  manualNote: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  pageTitle: z.string().nullable(),
  domain: z.string().nullable(),
  tags: z.array(z.string()),
  topic: z.string().nullable(),
  language: z.string().nullable(),
  isCode: z.boolean(),
  codeLanguage: z.string().nullable(),
  clientCreatedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  lastRevisitedAt: timestamp.nullable(),
  revisitCount: z.number().int().nonnegative(),
  version: positiveVersion,
});
export type Memory = z.infer<typeof memorySchema>;

type MemoryMetadataRequest = {
  title?: string | null; manualNote?: string | null; sourceUrl?: string | null;
  tags?: string[]; topic?: string | null; language?: string | null; isCode?: boolean;
  codeLanguage?: string | null; pageTitle?: string | null; domain?: string | null; clientCreatedAt?: string;
};
export type CreateMemoryRequest =
  | (MemoryMetadataRequest & { captureType: 'text'; selectedText: string })
  | (Omit<MemoryMetadataRequest, 'sourceUrl'> & { captureType: 'url'; sourceUrl: string; selectedText?: string | null });
export type UpdateMemoryRequest = {
  title?: string | null; manualNote?: string | null; tags?: string[]; topic?: string | null;
  language?: string | null; pageTitle?: string | null; domain?: string | null; isCode?: boolean; codeLanguage?: string | null;
};

export const memoryResponseSchema = z.object({ memory: memorySchema });
export type MemoryResponse = z.infer<typeof memoryResponseSchema>;
export const memoryListResponseSchema = z.object({
  memories: z.array(memorySchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
export type MemoryListResponse = z.infer<typeof memoryListResponseSchema>;

export type SearchFilters = {
  q?: string; page?: number; limit?: number; domain?: string; tags?: string[]; topic?: string;
  capture_type?: CaptureType; created_from?: string; created_to?: string; language?: string; is_code?: boolean;
};
export const searchResponseSchema = z.object({
  memories: z.array(memorySchema),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
  nextPage: z.number().int().positive().nullable(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const syncTombstoneSchema = z.object({ id: uuid, version: positiveVersion, deletedAt: timestamp });
export type SyncTombstone = z.infer<typeof syncTombstoneSchema>;
export const syncBootstrapResponseSchema = z.object({
  memories: z.array(memorySchema),
  tombstones: z.array(syncTombstoneSchema),
  cursor: z.string().regex(/^(0|[1-9]\d{0,18})$/),
  hasMore: z.boolean(),
  nextPageToken: z.string().nullable(),
});
export type SyncBootstrapResponse = z.infer<typeof syncBootstrapResponseSchema>;

export const syncChangeSchema = z.object({
  cursor: z.string().regex(/^(0|[1-9]\d{0,18})$/),
  memoryId: uuid,
  operation: z.enum(['create', 'update', 'delete']),
  version: positiveVersion,
  serverCreatedAt: timestamp,
  memory: z.union([memorySchema, syncTombstoneSchema, z.object({ id: uuid, version: positiveVersion, deletedAt: z.null() })]),
});
export type SyncChange = z.infer<typeof syncChangeSchema>;
export const syncChangesResponseSchema = z.object({
  changes: z.array(syncChangeSchema),
  nextCursor: z.string().regex(/^(0|[1-9]\d{0,18})$/),
  hasMore: z.boolean(),
});
export type SyncChangesResponse = z.infer<typeof syncChangesResponseSchema>;

export type SyncMutation =
  | { mutationId: string; operation: 'create'; memoryId: string; memory: CreateMemoryRequest }
  | { mutationId: string; operation: 'update'; memoryId: string; baseVersion: number; patch: UpdateMemoryRequest }
  | { mutationId: string; operation: 'delete'; memoryId: string; baseVersion: number };
export const syncMutationResultSchema = z.object({
  mutationId: uuid,
  status: z.enum(['applied', 'conflict', 'not_found', 'invalid']),
  code: z.string().optional(),
  memory: z.union([memorySchema, syncTombstoneSchema]).optional(),
  version: positiveVersion.optional(),
  baseVersion: positiveVersion.optional(),
  cursor: z.string().regex(/^(0|[1-9]\d{0,18})$/).optional(),
  replayed: z.boolean().optional(),
});
export type SyncMutationResult = z.infer<typeof syncMutationResultSchema>;
export const syncMutationsResponseSchema = z.object({ results: z.array(syncMutationResultSchema) });
export type SyncMutationsResponse = z.infer<typeof syncMutationsResponseSchema>;

export type ApiErrorKind = 'unauthenticated' | 'forbidden' | 'validation' | 'precondition_required' | 'not_found' | 'conflict' | 'rate_limited' | 'server' | 'network' | 'unknown';
