import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prepareTestDatabase, testConfig, testPool } from './test-db.js';

const app = createApp(testPool, testConfig);
const password = 'Correct horse battery staple 4!';
const origin = testConfig.AUTH_WEB_ORIGIN;
type Account = { id: string; token: string };

async function account(): Promise<Account> {
  const response = await request(app).post('/auth/register').set('Origin', origin).set('X-Memdev-Request', '1')
    .send({ email: `sync-api-${randomUUID()}@example.test`, password });
  assert.equal(response.status, 201);
  return { id: response.body.user.id as string, token: response.body.accessToken as string };
}

function api(user: Account) {
  return {
    get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${user.token}`),
    post: (path: string) => request(app).post(path).set('Authorization', `Bearer ${user.token}`),
    patch: (path: string) => request(app).patch(path).set('Authorization', `Bearer ${user.token}`),
  };
}

function newText(selectedText = 'Offline saved content') {
  return { captureType: 'text' as const, selectedText };
}

before(prepareTestDatabase);
after(async () => { await testPool.query("DELETE FROM users WHERE email LIKE 'sync-api-%@example.test'"); });

describe('offline synchronization API', () => {
  it('requires authentication and strictly validates scoped cursors and bounded batches', async () => {
    assert.equal((await request(app).get('/sync/bootstrap')).status, 401);
    assert.equal((await request(app).get('/sync/changes?cursor=0')).status, 401);
    assert.equal((await request(app).post('/sync/mutations').send({ mutations: [] })).status, 401);
    const user = await account();
    const owner = api(user);
    assert.equal((await owner.get('/sync/changes')).status, 400);
    assert.equal((await owner.get('/sync/changes').query({ cursor: '01' })).status, 400);
    assert.equal((await owner.get('/sync/changes').query({ cursor: '0', user_id: randomUUID() })).status, 400);
    assert.equal((await owner.get('/sync/changes').query({ cursor: '0', limit: 501 })).status, 400);
    assert.equal((await owner.post('/sync/mutations').send({ mutations: [] })).status, 400);
    assert.equal((await owner.post('/sync/mutations').send({ mutations: Array.from({ length: 26 }, () => ({})) })).status, 400);
  });

  it('bootstraps active memories, tombstones, and a per-user safe cursor', async () => {
    const user = await account();
    const owner = api(user);
    const memoryId = randomUUID();
    const created = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId, memory: newText('snapshot active') },
    ] });
    assert.equal(created.status, 200);
    const deletedId = randomUUID();
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId: deletedId, memory: newText('snapshot deleted') },
    ] });
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'delete', memoryId: deletedId, baseVersion: 1 },
    ] });
    const snapshot = await owner.get('/sync/bootstrap');
    assert.equal(snapshot.status, 200);
    assert.ok(snapshot.body.memories.some((memory: { id: string }) => memory.id === memoryId));
    assert.ok(snapshot.body.tombstones.some((memory: { id: string; version: number }) => memory.id === deletedId && memory.version === 2));
    const changes = await owner.get('/sync/changes').query({ cursor: '0' });
    assert.equal(changes.body.nextCursor, snapshot.body.cursor);
    assert.equal(changes.body.hasMore, false);
  });

  it('replays exact creates without duplicating memory, version, or change events', async () => {
    const user = await account();
    const owner = api(user);
    const mutation = { mutationId: randomUUID(), operation: 'create', memoryId: randomUUID(), memory: newText() };
    const first = await owner.post('/sync/mutations').send({ mutations: [mutation] });
    const replay = await owner.post('/sync/mutations').send({ mutations: [mutation] });
    assert.equal(first.body.results[0].status, 'applied');
    assert.equal(replay.body.results[0].replayed, true);
    assert.equal(replay.body.results[0].version, 1);
    const memoryCount = await testPool.query<{ count: string }>('SELECT count(*)::text AS count FROM memories WHERE user_id=$1 AND id=$2', [user.id, mutation.memoryId]);
    const changeCount = await testPool.query<{ count: string }>('SELECT count(*)::text AS count FROM memory_changes WHERE user_id=$1 AND memory_id=$2', [user.id, mutation.memoryId]);
    assert.equal(memoryCount.rows[0]?.count, '1');
    assert.equal(changeCount.rows[0]?.count, '1');
    const reused = await owner.post('/sync/mutations').send({ mutations: [{ ...mutation, memory: newText('different payload') }] });
    assert.equal(reused.body.results[0].code, 'IDEMPOTENCY_KEY_REUSED');
  });

  it('isolates mutation IDs and memory UUID collisions across users', async () => {
    const alice = await account();
    const bob = await account();
    const memoryId = randomUUID();
    const mutationId = randomUUID();
    const a = api(alice); const b = api(bob);
    const created = await a.post('/sync/mutations').send({ mutations: [
      { mutationId, operation: 'create', memoryId, memory: newText('private') },
    ] });
    assert.equal(created.body.results[0].status, 'applied');
    const collision = await b.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId, memory: newText('attack') },
    ] });
    assert.equal(collision.body.results[0].status, 'conflict');
    assert.equal('memory' in collision.body.results[0], false);
    const replayedKey = await b.post('/sync/mutations').send({ mutations: [
      { mutationId, operation: 'create', memoryId: randomUUID(), memory: newText('different user key') },
    ] });
    assert.equal(replayedKey.body.results[0].status, 'applied');
    const changesA = await a.get('/sync/changes').query({ cursor: '0' });
    const changesB = await b.get('/sync/changes').query({ cursor: '0' });
    assert.equal(changesA.body.changes.length, 1);
    assert.equal(changesB.body.changes.length, 1);
    assert.notEqual(changesA.body.changes[0].memoryId, changesB.body.changes[0].memoryId);
    assert.equal((await b.get('/sync/bootstrap')).body.memories.some((memory: { id: string }) => memory.id === memoryId), false);
  });

  it('detects stale multi-device updates and permits a refreshed retry', async () => {
    const user = await account();
    const owner = api(user);
    const memoryId = randomUUID();
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId, memory: newText() },
    ] });
    const deviceB = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 1, patch: { title: 'Device B' } },
    ] });
    assert.equal(deviceB.body.results[0].version, 2);
    const deviceA = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 1, patch: { title: 'Device A' } },
    ] });
    assert.equal(deviceA.status, 409);
    assert.equal(deviceA.body.results[0].status, 'conflict');
    assert.equal(deviceA.body.results[0].memory.title, 'Device B');
    assert.equal(deviceA.body.results[0].baseVersion, 1);
    assert.equal(deviceA.body.results[0].version, 2);
    const retry = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 2, patch: { title: 'Device A' } },
    ] });
    assert.equal(retry.body.results[0].status, 'applied');
    assert.equal(retry.body.results[0].version, 3);
  });

  it('serializes concurrent device mutations at one base version', async () => {
    const user = await account();
    const owner = api(user);
    const memoryId = randomUUID();
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId, memory: newText() },
    ] });
    const [deviceA, deviceB] = await Promise.all([
      owner.post('/sync/mutations').send({ mutations: [
        { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 1, patch: { title: 'Device A' } },
      ] }),
      owner.post('/sync/mutations').send({ mutations: [
        { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 1, patch: { title: 'Device B' } },
      ] }),
    ]);
    const outcomes = [deviceA, deviceB].map((response) => response.body.results[0].status).sort();
    assert.deepEqual(outcomes, ['applied', 'conflict']);
    assert.equal([deviceA, deviceB].filter((response) => response.status === 409).length, 1);
    const state = await testPool.query<{ version: number; title: string }>('SELECT version,title FROM memories WHERE id=$1', [memoryId]);
    assert.equal(state.rows[0]?.version, 2);
    const events = await testPool.query<{ version: number; cursor: string }>(
      'SELECT version,sequence_id::text AS cursor FROM memory_changes WHERE memory_id=$1 ORDER BY sequence_id', [memoryId]);
    assert.deepEqual(events.rows.map((event) => event.version), [1, 2]);
    const firstEvent = events.rows[0]; const secondEvent = events.rows[1];
    assert.ok(firstEvent && secondEvent);
    assert.ok(BigInt(firstEvent.cursor) < BigInt(secondEvent.cursor));
  });

  it('paginates repeatable per-user cursors and returns deletion tombstones while normal reads stay hidden', async () => {
    const user = await account(); const other = await account();
    const owner = api(user); const stranger = api(other);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < ids.length; i += 1) {
      await owner.post('/sync/mutations').send({ mutations: [
        { mutationId: randomUUID(), operation: 'create', memoryId: ids[i], memory: newText(`item ${i}`) },
      ] });
    }
    const first = await owner.get('/sync/changes').query({ cursor: '0', limit: 2 });
    assert.equal(first.body.changes.length, 2);
    assert.equal(first.body.hasMore, true);
    assert.equal(first.body.nextCursor, first.body.changes[1].cursor);
    const repeated = await owner.get('/sync/changes').query({ cursor: '0', limit: 2 });
    assert.deepEqual(repeated.body.changes.map((change: { cursor: string }) => change.cursor), first.body.changes.map((change: { cursor: string }) => change.cursor));
    const second = await owner.get('/sync/changes').query({ cursor: first.body.nextCursor, limit: 2 });
    assert.equal(second.body.changes.length, 1);
    assert.equal(second.body.hasMore, false);
    assert.equal(second.body.nextCursor, second.body.changes[0].cursor);
    const empty = await owner.get('/sync/changes').query({ cursor: second.body.nextCursor });
    assert.equal(empty.body.changes.length, 0);
    assert.equal(empty.body.nextCursor, second.body.nextCursor);
    assert.equal((await stranger.get('/sync/changes').query({ cursor: '0' })).body.changes.length, 0);

    const deletedId = ids[0];
    assert.ok(deletedId);
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'delete', memoryId: deletedId, baseVersion: 1 },
    ] });
    const afterDelete = await owner.get('/sync/changes').query({ cursor: second.body.nextCursor });
    assert.equal(afterDelete.body.changes[0].operation, 'delete');
    assert.equal(afterDelete.body.changes[0].memory.id, deletedId);
    assert.equal(afterDelete.body.changes[0].memory.version, 2);
    assert.ok(afterDelete.body.changes[0].memory.deletedAt);
    assert.equal((await owner.get(`/memories/${deletedId}`)).status, 404);
    assert.equal((await stranger.get('/sync/bootstrap')).body.tombstones.some((memory: { id: string }) => memory.id === deletedId), false);
  });

  it('establishes a race-free bootstrap boundary around concurrent writes', async () => {
    const user = await account();
    const owner = api(user);
    const lockClient = await testPool.connect();
    await lockClient.query('BEGIN');
    await lockClient.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    const snapshotPromise = owner.get('/sync/bootstrap');
    const mutationId = randomUUID(); const memoryId = randomUUID();
    const mutationPromise = owner.post('/sync/mutations').send({ mutations: [
      { mutationId, operation: 'create', memoryId, memory: newText('around snapshot') },
    ] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await lockClient.query('COMMIT');
    lockClient.release();
    const [snapshot, mutation] = await Promise.all([snapshotPromise, mutationPromise]);
    assert.equal(snapshot.status, 200);
    assert.equal(mutation.status, 200);
    const changeCursor = mutation.body.results[0].cursor as string;
    if (snapshot.body.memories.some((memory: { id: string }) => memory.id === memoryId)) {
      assert.ok(BigInt(snapshot.body.cursor) >= BigInt(changeCursor));
    } else {
      assert.ok(BigInt(snapshot.body.cursor) < BigInt(changeCursor));
      const tail = await owner.get('/sync/changes').query({ cursor: snapshot.body.cursor });
      assert.ok(tail.body.changes.some((change: { memoryId: string }) => change.memoryId === memoryId));
    }
  });
});
