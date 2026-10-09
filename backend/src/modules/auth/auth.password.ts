import bcrypt from 'bcrypt';
import type { AppConfig } from '../../config/env.js';

export const hashPassword = (password: string, config: AppConfig): Promise<string> =>
  bcrypt.hash(password, config.AUTH_BCRYPT_ROUNDS);
export const verifyPassword = (password: string, hash: string): Promise<boolean> =>
  bcrypt.compare(password, hash);
