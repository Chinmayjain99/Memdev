import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: ['password', 'DB_PASSWORD', 'req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
});
