import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prepareTestDatabase, testConfig, testPool } from './test-db.js';

const app = createApp(testPool, testConfig);
const password = 'Correct horse battery staple 4!';
const origin = testConfig.AUTH_WEB_ORIGIN;
const email = () => `memory-api-${randomUUID()}@example.test`;
type Account = { id: string; token: string };

async function account(): Promise<Account> {
  const response = await request(app).post('/auth/register').set('Origin', origin).set('X-Memdev-Request', '1')
    .send({ email: email(), password });
  assert.equal(response.status, 201);
  return { id: response.body.user.id as string, token: response.body.accessToken as string };
}

function api(account: Account) {
  return {
    post: (path: string) => request(app).post(path).set('Authorization', `Bearer ${account.token}`),
    get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${account.token}`),
    patch: (path: string) => request(app).patch(path).set('Authorization', `Bearer ${account.token}`),
    delete: (path: string) => request(app).delete(path).set('Authorization', `Bearer ${account.token}`),
  };
}

async function createText(user: Account, selectedText = 'A saved passage') {
  return api(user).post('/memories').send({ captureType: 'text', selectedText });
}

before(prepareTestDatabase);
after(async () => { await testPool.query("DELETE FROM users WHERE email LIKE 'memory-api-%@example.test'"); });

describe('authenticated memory API', () => {
  it('requires authentication for every memory endpoint', async () => {
    assert.equal((await request(app).post('/memories').send({ captureType: 'text', selectedText: 'x' })).status, 401);
    assert.equal((await request(app).get('/memories')).status, 401);
    const id = randomUUID();
    assert.equal((await request(app).get(`/memories/${id}`)).status, 401);
    assert.equal((await request(app).patch(`/memories/${id}`).send({ title: 'x' })).status, 401);
    assert.equal((await request(app).delete(`/memories/${id}`)).status, 401);
    assert.equal((await request(app).post(`/memories/${id}/revisit`)).status, 401);
  });

  it('validates capture types and creates safe text and URL memories', async () => {
    const user = await account();
    const ownerApi = api(user);
    assert.equal((await ownerApi.post('/memories').send({ captureType: 'other', selectedText: 'x' })).status, 400);
    assert.equal((await ownerApi.post('/memories').send({ captureType: 'text' })).status, 400);
    assert.equal((await ownerApi.post('/memories').send({ captureType: 'text', selectedText: '   ' })).status, 400);
    assert.equal((await ownerApi.post('/memories').send({ captureType: 'url', sourceUrl: 'not a URL' })).status, 400);
    assert.equal((await ownerApi.post('/memories').send({ captureType: 'url', sourceUrl: 'ftp://example.test' })).status, 400);
    const unsafe = await ownerApi.post('/memories').send({ captureType: 'text', selectedText: 'attempted override', user_id: randomUUID() });
    assert.equal(unsafe.status, 400);

    const text = await ownerApi.post('/memories').send({
      captureType: 'text', selectedText: '  Useful passage  ', title: ' Note title ', manualNote: 'keep this',
      tags: [' node ', 'postgres'], topic: 'backend', language: 'en', isCode: true, codeLanguage: 'typescript',
      clientCreatedAt: '2026-09-01T12:00:00.000Z', version: 90, revisitCount: 900,
    });
    assert.equal(text.status, 400); // Server-owned fields are rejected.
    const created = await ownerApi.post('/memories').send({
      captureType: 'text', selectedText: '  Useful passage  ', title: ' Note title ', manualNote: 'keep this',
      tags: [' node ', 'postgres'], topic: 'backend', language: 'en', isCode: true, codeLanguage: 'typescript',
      clientCreatedAt: '2026-09-01T12:00:00.000Z',
    });
    assert.equal(created.status, 201);
    const memory = created.body.memory;
    assert.equal(memory.selectedText, 'Useful passage');
    assert.equal(memory.title, 'Note title');
    assert.equal(memory.version, 1);
    assert.equal(memory.revisitCount, 0);
    assert.equal(memory.isCode, true);
    assert.equal(memory.codeLanguage, 'typescript');
    assert.equal('user_id' in memory, false);
    assert.equal('search_vector' in memory, false);
    const createdEtag = created.headers.etag;
    assert.ok(createdEtag);
    assert.match(createdEtag, /^"1"$/);
    const owner = await testPool.query<{ user_id: string; version: number }>('SELECT user_id,version FROM memories WHERE id=$1', [memory.id]);
    assert.equal(owner.rows[0]?.user_id, user.id);
    assert.equal(owner.rows[0]?.version, 1);

    const url = await ownerApi.post('/memories').send({
      captureType: 'url', sourceUrl: 'https://example.test/path', pageTitle: 'Page', domain: 'example.test',
    });
    assert.equal(url.status, 201);
    assert.equal(url.body.memory.sourceUrl, 'https://example.test/path');
    assert.equal(url.body.memory.selectedText, null);
    assert.equal(url.body.memory.tags.length, 0);
  });

  it('uses stable per-user keyset pagination, excludes tombstones, and rejects user-scope query overrides', async () => {
    const user = await account();
    const ownerApi = api(user);
    for (let index = 0; index < 3; index += 1) {
      const response = await ownerApi.post('/memories').send({ captureType: 'text', selectedText: `page ${index}` });
      assert.equal(response.status, 201);
    }
    const first = await ownerApi.get('/memories').query({ limit: 2 });
    assert.equal(first.status, 200);
    assert.equal(first.body.memories.length, 2);
    assert.equal(first.body.hasMore, true);
    assert.ok(first.body.nextCursor);
    const second = await ownerApi.get('/memories').query({ limit: 2, cursor: first.body.nextCursor });
    assert.equal(second.body.memories.length, 1);
    assert.equal(second.body.hasMore, false);
    assert.equal(second.body.nextCursor, null);
    const pages = [...first.body.memories, ...second.body.memories];
    assert.equal(new Set(pages.map((item) => item.id)).size, 3);
    const databaseOrder = await testPool.query<{ id: string }>(
      'SELECT id FROM memories WHERE user_id=$1 AND is_deleted=false ORDER BY created_at DESC,id ASC', [user.id]);
    assert.deepEqual(pages.map((item) => item.id), databaseOrder.rows.map((item) => item.id));
    assert.equal((await ownerApi.get('/memories').query({ user_id: randomUUID() })).status, 400);
    assert.equal((await ownerApi.get('/memories').query({ limit: 0 })).status, 400);
    assert.equal((await ownerApi.get('/memories').query({ cursor: 'not-a-cursor' })).status, 400);
    assert.equal((await ownerApi.get('/memories/not-a-uuid')).status, 400);
  });

  it('enforces isolation across get, update, delete, and revisit', async () => {
    const userA = await account();
    const userB = await account();
    const memoryA = await createText(userA);
    const memoryB = await createText(userB);
    assert.equal(memoryA.status, 201);
    assert.equal(memoryB.status, 201);
    const idA = memoryA.body.memory.id as string;
    const idB = memoryB.body.memory.id as string;
    const a = api(userA);
    const b = api(userB);

    assert.equal((await a.get(`/memories/${idA}`)).status, 200);
    assert.equal((await b.get(`/memories/${idB}`)).status, 200);
    assert.equal((await a.get(`/memories/${idB}`)).status, 404);
    assert.equal((await a.patch(`/memories/${idB}`).set('If-Match', '"1"').send({ title: 'steal' })).status, 404);
    assert.equal((await a.delete(`/memories/${idB}`)).status, 404);
    assert.equal((await a.post(`/memories/${idB}/revisit`)).status, 404);
    assert.equal((await b.get(`/memories/${idA}`)).status, 404);
    assert.equal((await b.patch(`/memories/${idA}`).set('If-Match', '"1"').send({ title: 'steal' })).status, 404);
    assert.equal((await b.delete(`/memories/${idA}`)).status, 404);
    assert.equal((await b.post(`/memories/${idA}/revisit`)).status, 404);
    const [listA, listB] = await Promise.all([a.get('/memories'), b.get('/memories')]);
    assert.ok(listA.body.memories.some((memory: { id: string }) => memory.id === idA));
    assert.ok(listA.body.memories.every((memory: { id: string }) => memory.id !== idB));
    assert.ok(listB.body.memories.some((memory: { id: string }) => memory.id === idB));
    assert.ok(listB.body.memories.every((memory: { id: string }) => memory.id !== idA));
  });

  it('uses If-Match versions for updates and records versioned atomic change events', async () => {
    const user = await account();
    const ownerApi = api(user);
    const created = await createText(user);
    const id = created.body.memory.id as string;
    assert.equal(created.body.memory.version, 1);
    assert.equal((await ownerApi.patch(`/memories/${id}`).send({ title: 'without version' })).status, 428);
    assert.equal((await ownerApi.patch(`/memories/${id}`).set('If-Match', 'invalid').send({ title: 'bad etag' })).status, 400);
    const changed = await ownerApi.patch(`/memories/${id}`).set('If-Match', '"1"').send({ title: 'Renamed', tags: ['updated'] });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.memory.version, 2);
    assert.equal(changed.body.memory.title, 'Renamed');
    const changedEtag = changed.headers.etag;
    assert.ok(changedEtag);
    assert.match(changedEtag, /^"2"$/);
    assert.equal((await ownerApi.patch(`/memories/${id}`).set('If-Match', '"1"').send({ title: 'stale' })).status, 409);
    assert.equal((await ownerApi.patch(`/memories/${id}`).set('If-Match', '"2"').send({ user_id: user.id })).status, 400);
    assert.equal((await ownerApi.patch(`/memories/${id}`).set('If-Match', '"2"').send({ version: 200 })).status, 400);
    assert.equal((await ownerApi.patch(`/memories/${id}`).set('If-Match', '"2"').send({ revisitCount: 99 })).status, 400);

    const [first, second] = await Promise.all([
      ownerApi.patch(`/memories/${id}`).set('If-Match', '"2"').send({ title: 'Concurrent one' }),
      ownerApi.patch(`/memories/${id}`).set('If-Match', '"2"').send({ title: 'Concurrent two' }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const events = await testPool.query<{ operation: string; version: number; user_id: string }>(
      'SELECT operation,version,user_id FROM memory_changes WHERE memory_id=$1 ORDER BY sequence_id', [id]);
    assert.deepEqual(events.rows.map(({ operation, version }) => [operation, version]), [['create', 1], ['update', 2], ['update', 3]]);
    assert.ok(events.rows.every((event) => event.user_id === user.id));
    assert.ok(events.rows.every((event, index) => index === 0 || Number(event.version) > Number(events.rows[index - 1]?.version)));
  });

  it('tracks revisits atomically, soft-deletes idempotently, and preserves tombstones and change events', async () => {
    const user = await account();
    const ownerApi = api(user);
    const created = await createText(user);
    const id = created.body.memory.id as string;
    const revisited = await ownerApi.post(`/memories/${id}/revisit`).send({ revisitCount: 99 });
    assert.equal(revisited.status, 200);
    assert.equal(revisited.body.memory.revisitCount, 1);
    assert.ok(revisited.body.memory.lastRevisitedAt);
    assert.equal(revisited.body.memory.version, 2);
    const removed = await ownerApi.delete(`/memories/${id}`);
    assert.equal(removed.status, 204);
    assert.equal((await ownerApi.delete(`/memories/${id}`)).status, 204);
    assert.equal((await ownerApi.get(`/memories/${id}`)).status, 404);
    assert.equal((await ownerApi.post(`/memories/${id}/revisit`)).status, 404);
    const list = await ownerApi.get('/memories');
    assert.ok(list.body.memories.every((memory: { id: string }) => memory.id !== id));
    const stored = await testPool.query<{ is_deleted: boolean; deleted_at: Date | null; version: number }>(
      'SELECT is_deleted,deleted_at,version FROM memories WHERE id=$1 AND user_id=$2', [id,user.id]);
    assert.equal(stored.rows[0]?.is_deleted, true);
    assert.ok(stored.rows[0]?.deleted_at);
    assert.equal(stored.rows[0]?.version, 3);
    const events = await testPool.query<{ operation: string; version: number; sequence_id: string }>(
      'SELECT operation,version,sequence_id FROM memory_changes WHERE memory_id=$1 ORDER BY sequence_id', [id]);
    assert.deepEqual(events.rows.map(({ operation, version }) => [operation, version]), [
      ['create', 1], ['update', 2], ['delete', 3],
    ]);
    const firstSequence = events.rows[0]?.sequence_id;
    const secondSequence = events.rows[1]?.sequence_id;
    const thirdSequence = events.rows[2]?.sequence_id;
    assert.ok(firstSequence && secondSequence && thirdSequence);
    assert.ok(BigInt(firstSequence) < BigInt(secondSequence));
    assert.ok(BigInt(secondSequence) < BigInt(thirdSequence));
  });
});
