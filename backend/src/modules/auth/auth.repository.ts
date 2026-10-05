import type { Pool, PoolClient } from 'pg';
import type { PublicUser } from './auth.types.js';

export type DbUser = PublicUser & { passwordHash: string | null };
type UserRow = { id: string; email: string | null; display_name: string | null; password_hash: string | null };
const mapUser = (row: UserRow): DbUser => ({ id: row.id, email: row.email, displayName: row.display_name, passwordHash: row.password_hash });

export async function findUserByEmail(pool: Pool, email: string): Promise<DbUser | null> {
  const result = await pool.query<UserRow>('SELECT id,email,display_name,password_hash FROM users WHERE lower(email)=lower($1)', [email]);
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}
export async function createUser(client: PoolClient, input: { id: string; email: string; displayName?: string; passwordHash: string }): Promise<DbUser> {
  const result = await client.query<UserRow>(
    `INSERT INTO users (id,email,display_name,password_hash) VALUES ($1,$2,$3,$4)
     RETURNING id,email,display_name,password_hash`,
    [input.id, input.email, input.displayName ?? null, input.passwordHash],
  );
  const row = result.rows[0];
  if (!row) throw new Error('User insert returned no row');
  return mapUser(row);
}
export async function findUserById(pool: Pool, id: string): Promise<PublicUser | null> {
  const result = await pool.query<UserRow>('SELECT id,email,display_name,password_hash FROM users WHERE id=$1', [id]);
  const row = result.rows[0];
  return row ? { id: row.id, email: row.email, displayName: row.display_name } : null;
}
export async function insertSession(client: PoolClient, input: { id: string; userId: string; familyId: string; hash: Buffer; expiresAt: Date }): Promise<void> {
  await client.query('INSERT INTO refresh_sessions (id,user_id,family_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,$5)',
    [input.id, input.userId, input.familyId, input.hash, input.expiresAt]);
}
