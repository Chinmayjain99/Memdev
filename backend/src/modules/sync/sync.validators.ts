import { z } from 'zod';
import { createMemorySchema, updateMemorySchema } from '../memories/memory.validators.js';

const uuid = z.string().uuid();
const version = z.number().int().min(1).max(2_147_483_647);
export const changesQuerySchema = z.strictObject({
  cursor: z.string().regex(/^(0|[1-9]\d{0,18})$/).refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
const createMutation = z.strictObject({ mutationId: uuid, operation: z.literal('create'), memoryId: uuid, memory: createMemorySchema });
const updateMutation = z.strictObject({ mutationId: uuid, operation: z.literal('update'), memoryId: uuid, baseVersion: version, patch: updateMemorySchema });
const deleteMutation = z.strictObject({ mutationId: uuid, operation: z.literal('delete'), memoryId: uuid, baseVersion: version });
export const mutationsBodySchema = z.strictObject({ mutations: z.array(z.discriminatedUnion('operation', [createMutation, updateMutation, deleteMutation])).min(1).max(25) });
export type SyncMutation = z.infer<typeof mutationsBodySchema>['mutations'][number];
