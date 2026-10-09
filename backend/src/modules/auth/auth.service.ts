import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AppConfig } from '../../config/env.js';
import { withTransaction } from '../../database/transaction.js';
import { hashPassword, verifyPassword } from './auth.password.js';
import { createUser, findUserByEmail, findUserById, insertSession } from './auth.repository.js';
import type { AuthResult, PublicUser } from './auth.types.js';
import type { LoginInput, RegisterInput } from './auth.validators.js';
import { signAccessToken } from './auth.tokens.js';

export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const tokenHash = (token: string): Buffer => createHash('sha256').update(token).digest();
const publicUser = (user: { id: string; email: string | null; displayName: string | null }): PublicUser =>
  ({ id: user.id, email: user.email, displayName: user.displayName });

export function createAuthService(pool: Pool, config: AppConfig) {
  async function newSession(client: PoolClient, user: PublicUser, familyId: string = randomUUID()): Promise<AuthResult & { sessionId: string }> {
    const refreshToken = randomBytes(32).toString('base64url');
    const accessToken = await signAccessToken(user.id, config);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + config.AUTH_REFRESH_TTL_DAYS * 86_400_000);
    await insertSession(client, { id, userId: user.id, familyId, hash: tokenHash(refreshToken), expiresAt });
    return { user, accessToken, expiresIn: config.AUTH_ACCESS_TTL_SECONDS, refreshToken, sessionId: id };
  }
  const createSessionForUser = (user: PublicUser): Promise<AuthResult> =>
    withTransaction(pool, (client) => newSession(client, user));

  return {
    async register(input: RegisterInput): Promise<AuthResult> {
      const passwordHash = await hashPassword(input.password, config);
      try {
        return await withTransaction(pool, async (client) => {
          const id = randomUUID();
          const user = publicUser(await createUser(client, { id, email: input.email,
            ...(input.displayName === undefined ? {} : { displayName: input.displayName }), passwordHash }));
          return newSession(client, user);
        });
      } catch (error) {
        if (isEmailConflict(error)) throw new AuthError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists');
        throw error;
      }
    },
    async login(input: LoginInput): Promise<AuthResult> {
      const user = await findUserByEmail(pool, input.email);
      const matches = user?.passwordHash
        ? await verifyPassword(input.password, user.passwordHash)
        : await hashPassword(input.password, config).then(() => false);
      if (!user || !user.passwordHash || !matches) throw new AuthError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      return createSessionForUser(publicUser(user));
    },
    // Future verified OAuth identities resolve to a user, then share this session/token path.
    createSessionForUser,
    async refresh(token: string): Promise<AuthResult> {
      const result = await withTransaction(pool, async (client) => {
        const found = await client.query<{ id: string; user_id: string; family_id: string; expires_at: Date; revoked_at: Date | null; replaced_by_session_id: string | null; email: string | null; display_name: string | null }>(
          `SELECT s.id,s.user_id,s.family_id,s.expires_at,s.revoked_at,s.replaced_by_session_id,u.email,u.display_name
           FROM refresh_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 FOR UPDATE OF s`, [tokenHash(token)]);
        const row = found.rows[0];
        if (!row) return { kind: 'invalid' as const };
        if (row.revoked_at) {
          if (row.replaced_by_session_id) {
            await client.query('UPDATE refresh_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE family_id=$1 AND revoked_at IS NULL', [row.family_id]);
            return { kind: 'replay' as const };
          }
          return { kind: 'invalid' as const };
        }
        if (new Date(row.expires_at).getTime() <= Date.now()) {
          await client.query('UPDATE refresh_sessions SET revoked_at=now() WHERE id=$1', [row.id]);
          return { kind: 'invalid' as const };
        }
        const user = { id: row.user_id, email: row.email, displayName: row.display_name };
        const next = await newSession(client, user, row.family_id);
        await client.query('UPDATE refresh_sessions SET revoked_at=now(),replaced_by_session_id=$2 WHERE id=$1', [row.id, next.sessionId]);
        return { kind: 'success' as const, next };
      });
      if (result.kind !== 'success') throw new AuthError(401, 'INVALID_REFRESH_TOKEN', 'Refresh session is invalid');
      return result.next;
    },
    async logout(token: string | undefined): Promise<void> {
      if (token) await pool.query('UPDATE refresh_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE token_hash=$1', [tokenHash(token)]);
    },
    async logoutAll(userId: string): Promise<void> {
      await pool.query('UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
    },
    me(userId: string): Promise<PublicUser | null> { return findUserById(pool, userId); },
  };
}

function isEmailConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' &&
    'constraint' in error && error.constraint === 'users_email_lower_unique_idx';
}
