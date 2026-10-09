import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fuseRankedCandidates, RRF_K } from '../../src/modules/search/search.service.js';

describe('search ranking', () => {
  it('combines source ranks with reciprocal rank fusion and stable tie-breaking', () => {
    const ranked = fuseRankedCandidates([
      { memoryId: 'shared', source: 'fts', rank: 1 },
      { memoryId: 'shared', source: 'fuzzy', rank: 1 },
      { memoryId: 'fts-only', source: 'fts', rank: 1 },
      { memoryId: 'tie-b', source: 'fuzzy', rank: 2 },
      { memoryId: 'tie-a', source: 'fts', rank: 2 },
    ]);

    assert.equal(RRF_K, 60);
    assert.deepEqual(ranked.map(({ memoryId }) => memoryId), ['shared', 'fts-only', 'tie-a', 'tie-b']);
    assert.equal(ranked[0]?.score, 2 / 61);
    assert.equal(ranked[1]?.score, 1 / 61);
    assert.equal(ranked[2]?.score, 1 / 62);
  });
});
