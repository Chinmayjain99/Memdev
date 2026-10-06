import { randomBytes } from 'node:crypto';
import { after } from 'node:test';

// Integration tests only target DB_TEST_NAME. Their ephemeral signing key is never used by the server.
process.env.NODE_ENV = 'test';
process.env.AUTH_JWT_SECRET = randomBytes(32).toString('base64url');
const { closeTestDatabase } = await import('./integration/test-db.js');

await import('./unit/app.test.js');
await import('./unit/search.test.js');
await import('./integration/database.test.js');
await import('./integration/auth.test.js');
await import('./integration/memory.test.js');
await import('./integration/search.test.js');
after(closeTestDatabase);
