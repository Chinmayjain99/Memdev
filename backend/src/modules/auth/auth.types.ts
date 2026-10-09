export type AuthenticatedUser = { id: string };
declare module 'express-serve-static-core' {
  interface Request { auth?: AuthenticatedUser }
}
export type PublicUser = { id: string; email: string | null; displayName: string | null };
export type AuthResult = { user: PublicUser; accessToken: string; expiresIn: number; refreshToken: string; sessionId: string };
