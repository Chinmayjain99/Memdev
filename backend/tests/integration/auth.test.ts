import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { SignJWT } from 'jose';
import { createApp } from '../../src/app.js';
import { prepareTestDatabase, testConfig, testPool } from './test-db.js';

const app = createApp(testPool, testConfig);
const origin = testConfig.AUTH_WEB_ORIGIN;
const password = 'Correct horse battery staple 4!';
const email = () => `auth-${randomUUID()}@example.test`;
const cookieValue = (response: request.Response): string => {
  const setCookie = response.headers['set-cookie'];
  const cookie = setCookie?.[0];
  assert.ok(cookie);
  return cookie.split(';')[0] ?? '';
};
const authPost = (path: string) => request(app).post(path).set('Origin', origin).set('X-Memdev-Request', '1');
const key = new TextEncoder().encode(testConfig.AUTH_JWT_SECRET);

before(prepareTestDatabase);
after(async () => {
  await testPool.query("DELETE FROM users WHERE email LIKE 'auth-%@example.test'");
});

describe('authentication API', () => {
  it('registers with bcrypt, sets an HttpOnly refresh cookie, and returns only safe user data', async () => {
    const userEmail = email();
    const response = await authPost('/auth/register').send({ email: userEmail, password, displayName: 'Test User' });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.email, userEmail);
    assert.ok(response.body.accessToken);
    assert.equal(response.body.expiresIn, testConfig.AUTH_ACCESS_TTL_SECONDS);
    assert.equal('refreshToken' in response.body, false);
    assert.equal('password_hash' in response.body.user, false);
    assert.equal('passwordHash' in response.body.user, false);
    const setCookie = response.headers['set-cookie']?.[0] ?? '';
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\/auth/i);
    assert.match(setCookie, /Max-Age=2592000/i);
    assert.doesNotMatch(setCookie, /; Secure/i);
    const stored = await testPool.query<{ password_hash: string; token_hash: Buffer }>(
      `SELECT u.password_hash,s.token_hash FROM users u JOIN refresh_sessions s ON s.user_id=u.id WHERE u.email=$1`, [userEmail]);
    const storedRow = stored.rows[0];
    assert.ok(storedRow);
    assert.match(storedRow.password_hash, /^\$2[aby]\$/);
    assert.notEqual(storedRow.password_hash, password);
    assert.notEqual(storedRow.token_hash.toString('base64url'), cookieValue(response).slice('memdev_refresh='.length));

    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${response.body.accessToken}`)
      .query({ user_id: randomUUID() });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, response.body.user.id);
    assert.equal('passwordHash' in me.body.user, false);
  });

  it('validates signup, rejects duplicate email, and keeps login failures generic', async () => {
    const userEmail = email();
    assert.equal((await authPost('/auth/register').send({ email: 'bad', password })).status, 400);
    assert.equal((await authPost('/auth/register').send({ email: userEmail, password: '' })).status, 400);
    assert.equal((await authPost('/auth/register').send({ email: userEmail, password: 'short' })).status, 400);
    assert.equal((await authPost('/auth/register').send({ email: userEmail, password })).status, 201);
    assert.equal((await authPost('/auth/register').send({ email: userEmail.toUpperCase(), password })).status, 409);
    const unknown = await authPost('/auth/login').send({ email: email(), password });
    const wrong = await authPost('/auth/login').send({ email: userEmail, password: 'Wrong password 123!' });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.deepEqual(unknown.body, wrong.body);
    assert.equal((await authPost('/auth/login').send({ email: userEmail, password })).status, 200);
  });

  it('rejects requests without the exact origin and custom CSRF header', async () => {
    const response = await request(app).post('/auth/logout').set('Origin', 'https://attacker.example').set('X-Memdev-Request', '1');
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, 'CSRF_REJECTED');
  });

  it('rotates refresh tokens, rejects old tokens, and revokes the family on detected replay', async () => {
    const registered = await authPost('/auth/register').send({ email: email(), password });
    const oldCookie = cookieValue(registered);
    const rotated = await authPost('/auth/refresh').set('Cookie', oldCookie);
    assert.equal(rotated.status, 200);
    const currentCookie = cookieValue(rotated);
    assert.notEqual(currentCookie, oldCookie);
    assert.equal((await authPost('/auth/refresh').set('Cookie', oldCookie)).status, 401);
    assert.equal((await authPost('/auth/refresh').set('Cookie', currentCookie)).status, 401);
    const active = await testPool.query<{ count: string }>(
      `SELECT count(*)::text count FROM refresh_sessions WHERE user_id=$1 AND revoked_at IS NULL`, [registered.body.user.id]);
    assert.equal(active.rows[0]?.count, '0');
  });

  it('rejects and revokes an expired refresh session', async () => {
    const registered = await authPost('/auth/register').send({ email: email(), password });
    const expired = randomBytes(32).toString('base64url');
    const digest = createHash('sha256').update(expired).digest();
    await testPool.query(
      `INSERT INTO refresh_sessions (user_id,token_hash,created_at,expires_at)
       VALUES ($1,$2,now()-interval '2 days',now()-interval '1 day')`, [registered.body.user.id, digest]);
    assert.equal((await authPost('/auth/refresh').set('Cookie', `memdev_refresh=${expired}`)).status, 401);
    const revoked = await testPool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM refresh_sessions WHERE token_hash=$1', [digest]);
    assert.ok(revoked.rows[0]?.revoked_at);
  });

  it('allows at most one concurrent rotation and invalidates the family after the loser replays', async () => {
    const registered = await authPost('/auth/register').send({ email: email(), password });
    const oldCookie = cookieValue(registered);
    const [one, two] = await Promise.all([
      authPost('/auth/refresh').set('Cookie', oldCookie), authPost('/auth/refresh').set('Cookie', oldCookie),
    ]);
    assert.deepEqual([one.status, two.status].sort(), [200, 401]);
    const winnerCookie = cookieValue(one.status === 200 ? one : two);
    assert.equal((await authPost('/auth/refresh').set('Cookie', winnerCookie)).status, 401);
  });

  it('expires, rejects malformed, tampered, invalid issuer/audience/subject, and missing access tokens', async () => {
    assert.equal((await request(app).get('/auth/me')).status, 401);
    assert.equal((await request(app).get('/auth/me').set('Authorization', 'Bearer malformed')).status, 401);
    const issued = Math.floor(Date.now() / 1000);
    const make = (claims: Record<string, unknown>, issuer = testConfig.AUTH_JWT_ISSUER, audience = testConfig.AUTH_JWT_AUDIENCE) =>
      new SignJWT({ token_use: 'access', ...claims }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(issuer).setAudience(audience).setIssuedAt(issued).setExpirationTime(issued + 60).sign(key);
    const badTokens = [
      await make({ sub: randomUUID() }, 'wrong-issuer'),
      await make({ sub: randomUUID() }, testConfig.AUTH_JWT_ISSUER, 'wrong-audience'),
      await make({ sub: 'not-a-uuid' }),
      await make({ sub: randomUUID(), token_use: 'refresh' }),
      await new SignJWT({ token_use: 'access', sub: randomUUID() }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(testConfig.AUTH_JWT_ISSUER).setAudience(testConfig.AUTH_JWT_AUDIENCE).setIssuedAt(issued - 100).setExpirationTime(issued - 1).sign(key),
    ];
    for (const token of badTokens) assert.equal((await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`)).status, 401);
    const tampered = `${await make({ sub: randomUUID() }).then((value) => value.slice(0, -1))}x`;
    assert.equal((await request(app).get('/auth/me').set('Authorization', `Bearer ${tampered}`)).status, 401);
  });

  it('logout clears and revokes the current cookie; logout-all is scoped to the authenticated user', async () => {
    const userA = await authPost('/auth/register').send({ email: email(), password });
    const userB = await authPost('/auth/register').send({ email: email(), password });
    const aCookie = cookieValue(userA);
    const loggedOut = await authPost('/auth/logout').set('Cookie', aCookie);
    assert.equal(loggedOut.status, 204);
    assert.match(loggedOut.headers['set-cookie']?.[0] ?? '', /Expires=Thu, 01 Jan 1970/i);
    assert.equal((await authPost('/auth/refresh').set('Cookie', aCookie)).status, 401);

    const anotherA = await authPost('/auth/login').send({ email: userA.body.user.email, password });
    const userBCookie = cookieValue(userB);
    const all = await authPost('/auth/logout-all').set('Authorization', `Bearer ${userA.body.accessToken}`)
      .send({ user_id: userB.body.user.id });
    assert.equal(all.status, 204);
    assert.equal((await authPost('/auth/refresh').set('Cookie', cookieValue(anotherA))).status, 401);
    assert.equal((await authPost('/auth/refresh').set('Cookie', userBCookie)).status, 200);
  });

  it('sets Secure in production configuration and rejects body-supplied user identity', async () => {
    const prodConfig = { ...testConfig, NODE_ENV: 'production' as const, AUTH_WEB_ORIGIN: 'https://app.example.test' };
    const prodApp = createApp(testPool, prodConfig);
    const response = await request(prodApp).post('/auth/register').set('Origin', prodConfig.AUTH_WEB_ORIGIN)
      .set('X-Memdev-Request', '1').send({ email: email(), password });
    assert.equal(response.status, 201);
    assert.match(response.headers['set-cookie']?.[0] ?? '', /; Secure/i);
    const me = await request(app).get('/auth/me').set('Authorization', `Bearer ${response.body.accessToken}`);
    assert.equal(me.status, 200);
    assert.notEqual(me.body.user.id, randomUUID());
  });
});
