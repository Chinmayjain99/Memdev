import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  DB_HOST: z.string().trim().min(1).default('localhost'),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DB_NAME: z.string().trim().min(1).default('memdev'),
  DB_USER: z.string().trim().min(1).default('postgres'),
  DB_PASSWORD: z.string().default(''),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function parseConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const config = environmentSchema.parse(environment);
  if (config.NODE_ENV === 'production' && config.DB_PASSWORD.length === 0) {
    throw new Error('DB_PASSWORD must be set in production');
  }
  return config;
}
