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

  it('pages a bounded bootstrap while the fixed boundary catches writes between pages', async () => {
    const user = await account(); const owner = api(user);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      const response = await owner.post('/sync/mutations').send({ mutations: [
        { mutationId: randomUUID(), operation: 'create', memoryId: id, memory: newText(`paged item ${index}`) },
      ] });
      assert.equal(response.status, 200);
    }
    let page = await owner.get('/sync/bootstrap').query({ limit: 1 });
    assert.equal(page.status, 200);
    assert.equal(page.body.hasMore, true);
    const boundary = page.body.cursor as string;
    const firstToken = page.body.nextPageToken as string;
    assert.ok(firstToken);
    assert.equal((await owner.get('/sync/bootstrap').query({ limit: 1, pageToken: 'invalid' })).status, 400);

    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'update', memoryId: ids[1], baseVersion: 1, patch: { title: 'changed after boundary' } },
      { mutationId: randomUUID(), operation: 'delete', memoryId: ids[2], baseVersion: 1 },
      { mutationId: randomUUID(), operation: 'create', memoryId: randomUUID(), memory: newText('created after boundary') },
    ] });

    const snapshotIds = new Set<string>();
    for (const memory of [...page.body.memories, ...page.body.tombstones]) snapshotIds.add(memory.id as string);
    let token: string | null = firstToken;
    while (token) {
      page = await owner.get('/sync/bootstrap').query({ limit: 1, pageToken: token });
      assert.equal(page.status, 200);
      assert.equal(page.body.cursor, boundary);
      for (const memory of [...page.body.memories, ...page.body.tombstones]) snapshotIds.add(memory.id as string);
      token = page.body.nextPageToken as string | null;
    }
    assert.ok(ids.every((id) => snapshotIds.has(id)));
    const tail = await owner.get('/sync/changes').query({ cursor: boundary });
    assert.ok(tail.body.changes.some((change: { memoryId: string; operation: string }) => change.memoryId === ids[1] && change.operation === 'update'));
    assert.ok(tail.body.changes.some((change: { memoryId: string; operation: string }) => change.memoryId === ids[2] && change.operation === 'delete'));
    assert.equal(tail.body.changes.length, 3);
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
    const timestamped = { mutationId: randomUUID(), operation: 'create', memoryId: randomUUID(),
      memory: { ...newText('same text'), clientCreatedAt: '2026-01-01T00:00:00.000Z' } };
    assert.equal((await owner.post('/sync/mutations').send({ mutations: [timestamped] })).body.results[0].status, 'applied');
    const changedTimestamp = { ...timestamped, memory: { ...timestamped.memory, clientCreatedAt: '2026-01-02T00:00:00.000Z' } };
    const dateReuse = await owner.post('/sync/mutations').send({ mutations: [changedTimestamp] });
    assert.equal(dateReuse.status, 409);
    assert.equal(dateReuse.body.results[0].code, 'IDEMPOTENCY_KEY_REUSED');
  });

  it('serializes concurrent retries of the same user-scoped mutation ID', async () => {
    const user = await account(); const owner = api(user);
    const mutation = { mutationId: randomUUID(), operation: 'create', memoryId: randomUUID(), memory: newText('same retry') };
    const [first, second] = await Promise.all([
      owner.post('/sync/mutations').send({ mutations: [mutation] }),
      owner.post('/sync/mutations').send({ mutations: [mutation] }),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.results[0].cursor, second.body.results[0].cursor);
    const replayFlags = [first.body.results[0].replayed, second.body.results[0].replayed];
    assert.ok(replayFlags.includes(undefined));
    assert.ok(replayFlags.includes(true));
    const counts = await testPool.query<{ memories: string; changes: string }>(
      `SELECT (SELECT count(*)::text FROM memories WHERE user_id=$1 AND id=$2) AS memories,
              (SELECT count(*)::text FROM memory_changes WHERE user_id=$1 AND memory_id=$2) AS changes`,
      [user.id, mutation.memoryId]);
    assert.equal(counts.rows[0]?.memories, '1');
    assert.equal(counts.rows[0]?.changes, '1');
  });

  it('returns every sequential batch result when one state-dependent update is invalid', async () => {
    const user = await account(); const owner = api(user);
    const existingId = randomUUID();
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId: existingId, memory: newText('not code') },
    ] });
    const firstId = randomUUID(); const lastId = randomUUID();
    const batch = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId: firstId, memory: newText('first') },
      { mutationId: randomUUID(), operation: 'update', memoryId: existingId, baseVersion: 1, patch: { codeLanguage: 'typescript' } },
      { mutationId: randomUUID(), operation: 'create', memoryId: lastId, memory: newText('last') },
    ] });
    assert.equal(batch.status, 400);
    assert.deepEqual(batch.body.results.map((result: { status: string }) => result.status), ['applied', 'invalid', 'applied']);
    assert.ok(batch.body.results[1].code);
    assert.equal((await owner.get(`/memories/${firstId}`)).status, 200);
    assert.equal((await owner.get(`/memories/${lastId}`)).status, 200);
  });

  it('continues after a conflict and returns an outcome for each partial batch item', async () => {
    const user = await account(); const owner = api(user); const targetId = randomUUID();
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId: targetId, memory: newText('target') },
    ] });
    const firstId = randomUUID(); const lastId = randomUUID();
    const mutations = [
      { mutationId: randomUUID(), operation: 'create', memoryId: firstId, memory: newText('first item') },
      { mutationId: randomUUID(), operation: 'update', memoryId: targetId, baseVersion: 9, patch: { title: 'stale' } },
      { mutationId: randomUUID(), operation: 'create', memoryId: lastId, memory: newText('last item') },
    ];
    const response = await owner.post('/sync/mutations').send({ mutations });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body.results.map((result: { status: string }) => result.status), ['applied', 'conflict', 'applied']);
    assert.equal((await owner.get(`/memories/${firstId}`)).status, 200);
    assert.equal((await owner.get(`/memories/${lastId}`)).status, 200);
    const replay = await owner.post('/sync/mutations').send({ mutations });
    assert.equal(replay.status, 409);
    assert.ok(replay.body.results.every((result: { replayed?: boolean }) => result.replayed === true));
  });

  it('processes dependent mutations sequentially in array order', async () => {
    const user = await account(); const owner = api(user); const memoryId = randomUUID();
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId, memory: newText('ordered') },
    ] });
    const response = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 1, patch: { title: 'first update' } },
      { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 2, patch: { title: 'second update' } },
    ] });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.results.map((result: { version: number }) => result.version), [2, 3]);
    const final = await owner.get(`/memories/${memoryId}`);
    assert.equal(final.body.memory.version, 3);
    assert.equal(final.body.memory.title, 'second update');
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
    const foreignUpdate = await b.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 1, patch: { title: 'foreign edit' } },
    ] });
    const foreignDelete = await b.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'delete', memoryId, baseVersion: 1 },
    ] });
    assert.equal(foreignUpdate.body.results[0].status, 'not_found');
    assert.equal(foreignDelete.body.results[0].status, 'not_found');
    assert.equal('memory' in foreignUpdate.body.results[0], false);
    assert.equal((await a.get(`/memories/${memoryId}`)).body.memory.title, null);
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

  it('rejects stale deletes, soft-deletes at the current version, and keeps duplicate deletes idempotent', async () => {
    const user = await account(); const owner = api(user); const memoryId = randomUUID();
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId, memory: newText() },
    ] });
    await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 1, patch: { title: 'new version' } },
    ] });
    const staleDelete = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'delete', memoryId, baseVersion: 1 },
    ] });
    assert.equal(staleDelete.status, 409);
    assert.equal(staleDelete.body.results[0].memory.title, 'new version');
    assert.equal((await owner.get(`/memories/${memoryId}`)).status, 200);
    const deletion = { mutationId: randomUUID(), operation: 'delete', memoryId, baseVersion: 2 };
    const removed = await owner.post('/sync/mutations').send({ mutations: [deletion] });
    const replay = await owner.post('/sync/mutations').send({ mutations: [deletion] });
    assert.equal(removed.body.results[0].version, 3);
    assert.equal(replay.body.results[0].replayed, true);
    assert.equal(replay.body.results[0].memory.version, 3);
    assert.equal((await owner.get(`/memories/${memoryId}`)).status, 404);
    const staleUpdateAfterDelete = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'update', memoryId, baseVersion: 2, patch: { title: 'resurrection attempt' } },
    ] });
    assert.equal(staleUpdateAfterDelete.status, 409);
    assert.equal(staleUpdateAfterDelete.body.results[0].memory.deletedAt !== undefined, true);
    assert.equal((await testPool.query<{ is_deleted: boolean; version: number }>(
      'SELECT is_deleted,version FROM memories WHERE id=$1', [memoryId])).rows[0]?.is_deleted, true);
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

  it('makes sync-created memories searchable through the existing search index', async () => {
    const user = await account(); const owner = api(user); const memoryId = randomUUID();
    const created = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'create', memoryId,
        memory: { ...newText('sync searchable body'), title: 'sync trigger indexed phrase', tags: ['offline-sync-tag'] } },
    ] });
    assert.equal(created.status, 200);
    const search = await owner.get('/memories/search').query({ q: 'trigger indexed' });
    assert.ok(search.body.memories.some((memory: { id: string }) => memory.id === memoryId));
  });

  it('keeps revisit server-side while making its versioned event pull-visible', async () => {
    const user = await account(); const owner = api(user);
    const created = await owner.post('/memories').send(newText('revisit remains server-side'));
    assert.equal(created.status, 201);
    const memoryId = created.body.memory.id as string;
    const revisit = await owner.post(`/memories/${memoryId}/revisit`);
    assert.equal(revisit.status, 200);
    assert.equal(revisit.body.memory.revisitCount, 1);
    const pulled = await owner.get('/sync/changes').query({ cursor: '0' });
    assert.deepEqual(pulled.body.changes.map((change: { operation: string }) => change.operation), ['create', 'update']);
    assert.equal(pulled.body.changes[1].version, 2);
    assert.equal(pulled.body.changes[1].memory.revisitCount, 1);
    const rejected = await owner.post('/sync/mutations').send({ mutations: [
      { mutationId: randomUUID(), operation: 'revisit', memoryId },
    ] });
    assert.equal(rejected.status, 400);
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
