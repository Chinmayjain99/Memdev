import { z } from 'zod';

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
export type PublicUser = { id: string; email: string | null; displayName: string | null };
export type AuthResponse = { user: PublicUser; accessToken: string; expiresIn: number };
export type AuthRequest = { email: string; password: string };
export type RegisterRequest = AuthRequest & { displayName?: string };

export type CaptureType = 'text' | 'url';
export type Memory = {
  id: string; captureType: CaptureType; title: string | null; selectedText: string | null;
  manualNote: string | null; sourceUrl: string | null; pageTitle: string | null; domain: string | null;
  tags: string[]; topic: string | null; language: string | null; isCode: boolean;
  codeLanguage: string | null; clientCreatedAt: string | null; createdAt: string; updatedAt: string;
  lastRevisitedAt: string | null; revisitCount: number; version: number;
};
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
export type MemoryResponse = { memory: Memory };
export type MemoryListResponse = { memories: Memory[]; hasMore: boolean; nextCursor: string | null };
export type SearchFilters = {
  q?: string; page?: number; limit?: number; domain?: string; tags?: string[]; topic?: string;
  capture_type?: CaptureType; created_from?: string; created_to?: string; language?: string; is_code?: boolean;
};
export type SearchResponse = {
  memories: Memory[]; page: number; limit: number; hasMore: boolean; nextPage: number | null;
};
export type SyncTombstone = { id: string; version: number; deletedAt: string };
export type SyncBootstrapResponse = {
  memories: Memory[]; tombstones: SyncTombstone[]; cursor: string; hasMore: boolean; nextPageToken: string | null;
};
export type SyncChange = {
  cursor: string; memoryId: string; operation: 'create' | 'update' | 'delete';
  version: number; serverCreatedAt: string; memory: Memory | SyncTombstone | { id: string; version: number; deletedAt: null };
};
export type SyncChangesResponse = { changes: SyncChange[]; nextCursor: string; hasMore: boolean };
export type SyncMutation =
  | { mutationId: string; operation: 'create'; memoryId: string; memory: CreateMemoryRequest }
  | { mutationId: string; operation: 'update'; memoryId: string; baseVersion: number; patch: UpdateMemoryRequest }
  | { mutationId: string; operation: 'delete'; memoryId: string; baseVersion: number };
export type SyncMutationResult = {
  mutationId: string; status: 'applied' | 'conflict' | 'not_found' | 'invalid'; code?: string;
  memory?: Memory | SyncTombstone; version?: number; baseVersion?: number; cursor?: string; replayed?: boolean;
};
export type SyncMutationsResponse = { results: SyncMutationResult[] };

export type ApiErrorKind = 'unauthenticated' | 'forbidden' | 'validation' | 'precondition_required' | 'not_found' | 'conflict' | 'rate_limited' | 'server' | 'network' | 'unknown';
