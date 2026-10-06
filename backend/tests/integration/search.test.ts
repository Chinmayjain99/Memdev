import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prepareTestDatabase, testConfig, testPool } from './test-db.js';

const app = createApp(testPool, testConfig);
const password = 'Correct horse battery staple 4!';
const origin = testConfig.AUTH_WEB_ORIGIN;
const email = () => `search-api-${randomUUID()}@example.test`;
type Account = { id: string; token: string };

async function account(): Promise<Account> {
  const response = await request(app).post('/auth/register').set('Origin', origin).set('X-Memdev-Request', '1')
    .send({ email: email(), password });
  assert.equal(response.status, 201);
  return { id: response.body.user.id as string, token: response.body.accessToken as string };
}

function api(user: Account) {
  return {
    get: (path = '/memories/search') => request(app).get(path).set('Authorization', `Bearer ${user.token}`),
    post: (path: string) => request(app).post(path).set('Authorization', `Bearer ${user.token}`),
    delete: (path: string) => request(app).delete(path).set('Authorization', `Bearer ${user.token}`),
  };
}

async function createText(user: Account, data: Record<string, unknown>) {
  return api(user).post('/memories').send({ captureType: 'text', selectedText: 'searchable saved text', ...data });
}

before(prepareTestDatabase);
after(async () => { await testPool.query("DELETE FROM users WHERE email LIKE 'search-api-%@example.test'"); });

describe('authenticated memory search', () => {
  it('requires authentication, validates filters, and treats missing or empty q as filtered listing', async () => {
    assert.equal((await request(app).get('/memories/search')).status, 401);
    const user = await account();
    const created = await createText(user, { title: 'Empty query listing', domain: 'empty.example' });
    assert.equal(created.status, 201);
    assert.equal((await api(user).get().query({ domain: 'empty.example' })).body.memories[0]?.id, created.body.memory.id);
    assert.equal((await api(user).get().query({ q: '' })).status, 200);
    assert.equal((await api(user).get().query({ user_id: user.id })).status, 400);
    assert.equal((await api(user).get().query({ capture_type: 'other' })).status, 400);
    assert.equal((await api(user).get().query({ q: 'x'.repeat(201) })).status, 400);
    assert.equal((await api(user).get().query({ page: 0 })).status, 400);
    assert.equal((await api(user).get().query({ limit: 51 })).status, 400);
    assert.equal((await api(user).get().query({ created_from: 'not-a-date' })).status, 400);
    assert.equal((await api(user).get().query({ created_from: '2026-05-02T00:00:00Z', created_to: '2026-05-01T00:00:00Z' })).status, 400);
    assert.equal((await api(user).get().query({ tags: ',,' })).status, 400);
  });

  it('uses weighted FTS across title, tags, content, and domain with title priority', async () => {
    const user = await account();
    const owner = api(user);
    const title = await createText(user, {
      title: 'React Router Dynamic Routes', selectedText: 'ordinary implementation notes',
      tags: ['tagneedle'], domain: 'domainneedle.example', topic: 'frontend',
    });
    const content = await createText(user, { title: 'Unrelated notebook', selectedText: 'React Router implementation' });
    const byText = await owner.get().query({ q: 'React Router' });
    assert.equal(byText.status, 200);
    assert.equal(byText.body.memories[0]?.id, title.body.memory.id);
    assert.ok(byText.body.memories.some((memory: { id: string }) => memory.id === content.body.memory.id));
    assert.ok(byText.body.memories.every((memory: { user_id?: string; search_vector?: string }) =>
      memory.user_id === undefined && memory.search_vector === undefined));

    assert.ok((await owner.get().query({ q: 'tagneedle' })).body.memories.some(
      (memory: { id: string }) => memory.id === title.body.memory.id));
    assert.ok((await owner.get().query({ q: 'domainneedle.example' })).body.memories.some(
      (memory: { id: string }) => memory.id === title.body.memory.id));
  });

  it('recovers title misspellings through trigram matching without broad unrelated matches', async () => {
    const user = await account();
    const target = await createText(user, { title: 'Authentication protocols' });
    await createText(user, { title: 'Grocery shopping' });
    const response = await api(user).get().query({ q: 'authentcation' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.memories.map((memory: { id: string }) => memory.id), [target.body.memory.id]);
  });

  it('fuses FTS-only, fuzzy-only, and shared results deterministically', async () => {
    const user = await account();
    const shared = await createText(user, { title: 'Authentication protocols', selectedText: 'account security' });
    const ftsOnly = await createText(user, { title: 'Unrelated notebook', selectedText: 'authentication authentication authentication' });
    const fuzzyOnly = await createText(user, { title: 'Authentcation protocols', selectedText: 'account security' });
    const first = await api(user).get().query({ q: 'authentication' });
    const second = await api(user).get().query({ q: 'authentication' });
    assert.equal(first.status, 200);
    const ids = first.body.memories.map((memory: { id: string }) => memory.id);
    assert.equal(ids[0], shared.body.memory.id);
    assert.ok(ids.includes(ftsOnly.body.memory.id));
    assert.ok(ids.includes(fuzzyOnly.body.memory.id));
    assert.deepEqual(second.body.memories.map((memory: { id: string }) => memory.id), ids);
  });

  it('scopes exact, fuzzy, filtered, ranked, and paginated searches to the authenticated user', async () => {
    const userA = await account();
    const userB = await account();
    const aExact = await createText(userA, { title: 'Secret React project', topic: 'private' });
    const bExact = await createText(userB, { title: 'Secret React project', topic: 'private' });
    const aFuzzy = await createText(userA, { title: 'Authentication private project' });
    const bFuzzy = await createText(userB, { title: 'Authentication private project' });
    const searchA = api(userA);
    const searchB = api(userB);
    const exactA = await searchA.get().query({ q: 'Secret React', topic: 'private' });
    const exactB = await searchB.get().query({ q: 'Secret React', topic: 'private' });
    assert.deepEqual(exactA.body.memories.map((memory: { id: string }) => memory.id), [aExact.body.memory.id]);
    assert.deepEqual(exactB.body.memories.map((memory: { id: string }) => memory.id), [bExact.body.memory.id]);
    assert.deepEqual((await searchA.get().query({ q: 'authentcation' })).body.memories.map((memory: { id: string }) => memory.id), [aFuzzy.body.memory.id]);
    assert.deepEqual((await searchB.get().query({ q: 'authentcation' })).body.memories.map((memory: { id: string }) => memory.id), [bFuzzy.body.memory.id]);
    assert.deepEqual((await searchA.get().query({ q: 'Secret React proje' })).body.memories.map(
      (memory: { id: string }) => memory.id), [aExact.body.memory.id]);

    for (let index = 0; index < 4; index += 1) {
      await createText(userA, { title: 'Secret React project', selectedText: `secret pagination ${index}` });
    }
    const firstPage = await searchA.get().query({ q: 'Secret React', limit: 2, page: 1 });
    const repeatFirstPage = await searchA.get().query({ q: 'Secret React', limit: 2, page: 1 });
    const secondPage = await searchA.get().query({ q: 'Secret React', limit: 2, page: 2 });
    assert.deepEqual(repeatFirstPage.body.memories.map((memory: { id: string }) => memory.id),
      firstPage.body.memories.map((memory: { id: string }) => memory.id));
    assert.ok(firstPage.body.memories.every((memory: { id: string }) => memory.id !== bExact.body.memory.id));
    assert.ok(secondPage.body.memories.every((memory: { id: string }) => memory.id !== bExact.body.memory.id));
    assert.equal(new Set([...firstPage.body.memories, ...secondPage.body.memories].map((memory: { id: string }) => memory.id)).size, 4);
  });

  it('combines metadata filters, paginates without duplicates, and excludes soft-deleted memories', async () => {
    const user = await account();
    const owner = api(user);
    const filtered = await createText(user, {
      title: 'Filterable capture', domain: 'filters.example', tags: ['alpha', 'beta'],
      topic: 'project notes', language: 'en', isCode: true, codeLanguage: 'typescript',
    });
    const url = await owner.post('/memories').send({
      captureType: 'url', sourceUrl: 'https://filters.example/page', title: 'URL capture',
      domain: 'filters.example', tags: ['alpha'], topic: 'project notes',
    });
    assert.equal(url.status, 201);
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const combination = await owner.get().query({
      q: '', domain: 'filters.example', tags: 'alpha,beta', topic: 'project notes',
      capture_type: 'text', created_from: from, created_to: to, language: 'en', is_code: 'true',
    });
    assert.deepEqual(combination.body.memories.map((memory: { id: string }) => memory.id), [filtered.body.memory.id]);
    assert.deepEqual((await owner.get().query({ q: '', capture_type: 'url' })).body.memories.map(
      (memory: { id: string }) => memory.id), [url.body.memory.id]);

    const captures = [] as string[];
    for (let index = 0; index < 5; index += 1) {
      const response = await createText(user, { title: 'Pagination marker', selectedText: 'consistent page term' });
      captures.push(response.body.memory.id as string);
    }
    const page1 = await owner.get().query({ q: 'Pagination marker', limit: 2, page: 1 });
    const page2 = await owner.get().query({ q: 'Pagination marker', limit: 2, page: 2 });
    const page3 = await owner.get().query({ q: 'Pagination marker', limit: 2, page: 3 });
    const ids = [...page1.body.memories, ...page2.body.memories, ...page3.body.memories]
      .map((memory: { id: string }) => memory.id);
    assert.equal(new Set(ids).size, 5);
    assert.deepEqual(new Set(ids), new Set(captures));
    assert.equal(page1.body.nextPage, 2);
    assert.equal(page3.body.hasMore, false);
    assert.equal(page3.body.nextPage, null);

    assert.equal((await owner.delete(`/memories/${captures[0]}`)).status, 204);
    assert.ok(!(await owner.get().query({ q: 'Pagination marker' })).body.memories.some(
      (memory: { id: string }) => memory.id === captures[0]));
  });
});
