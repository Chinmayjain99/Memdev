import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CaptureType, Memory, SearchFilters } from '@memdev/contracts';
import { searchMemories } from '../../services/api/search-api';
import { ApiError } from '../../services/api/client';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { EmptyState, ErrorState, LoadingState } from '../../components/common/States';
import { MemoryFeed } from '../memories/MemoryComponents';

type FilterForm = { q: string; domain: string; tags: string; topic: string; captureType: string; from: string; to: string; language: string; code: string };
const initial: FilterForm = { q: '', domain: '', tags: '', topic: '', captureType: '', from: '', to: '', language: '', code: '' };

export function SearchPage() {
  const [form, setForm] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [page, setPage] = useState(1);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const sequence = useRef(0);

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(applied.q.trim()), 300); return () => window.clearTimeout(timer); }, [applied.q]);
  useEffect(() => {
    const request = ++sequence.current;
    setLoading(true); setError('');
    const filters: SearchFilters = {
      q: debouncedQuery || undefined, page, limit: 20,
      domain: applied.domain.trim() || undefined,
      tags: applied.tags.split(',').map((item) => item.trim()).filter(Boolean),
      topic: applied.topic.trim() || undefined,
      capture_type: (applied.captureType || undefined) as CaptureType | undefined,
      created_from: applied.from ? `${applied.from}T00:00:00.000Z` : undefined,
      created_to: applied.to ? `${applied.to}T23:59:59.999Z` : undefined,
      language: applied.language.trim() || undefined,
      is_code: applied.code ? applied.code === 'true' : undefined,
    };
    void searchMemories(filters).then((result) => {
      if (sequence.current === request) { setMemories(result.memories); setHasMore(result.hasMore); }
    }).catch((cause: unknown) => {
      if (sequence.current === request) setError(cause instanceof ApiError ? cause.message : 'Search could not be completed.');
    }).finally(() => { if (sequence.current === request) setLoading(false); });
    return () => { sequence.current += 1; };
  }, [applied, page, debouncedQuery]);

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPage(1); setApplied(form); }
  function update<K extends keyof FilterForm>(key: K, value: FilterForm[K]) { setForm((current) => ({ ...current, [key]: value })); }
  return <>
    <div className="page-heading"><div><p className="eyebrow">FIND YOUR WAY BACK</p><h1>Search your memories</h1><p className="page-intro">Look across saved snippets, pages, and notes.</p></div></div>
    <form className="search-panel panel" onSubmit={submit}>
      <Input label="Search" name="q" type="search" placeholder="Try a phrase, title, or idea…" value={form.q} onChange={(event) => { update('q', event.target.value); setApplied((current) => ({ ...current, q: event.target.value })); setPage(1); }} />
      <details className="filter-details"><summary>Filters</summary><div className="filter-grid">
        <Input label="Domain" name="domain" value={form.domain} onChange={(event) => update('domain', event.target.value)} />
        <Input label="Tags (comma separated)" name="tags" value={form.tags} onChange={(event) => update('tags', event.target.value)} />
        <Input label="Topic" name="topic" value={form.topic} onChange={(event) => update('topic', event.target.value)} />
        <label className="field"><span>Capture type</span><select value={form.captureType} onChange={(event) => update('captureType', event.target.value)}><option value="">Any</option><option value="text">Text</option><option value="url">Web page</option></select></label>
        <Input label="Created from" name="from" type="date" value={form.from} onChange={(event) => update('from', event.target.value)} />
        <Input label="Created to" name="to" type="date" value={form.to} onChange={(event) => update('to', event.target.value)} />
        <Input label="Language" name="language" value={form.language} onChange={(event) => update('language', event.target.value)} />
        <label className="field"><span>Code</span><select value={form.code} onChange={(event) => update('code', event.target.value)}><option value="">Any</option><option value="true">Code</option><option value="false">Not code</option></select></label>
      </div></details>
      <div className="search-submit"><Button className="primary action-button" type="submit">Apply filters</Button></div>
    </form>
    <section className="feed-section" aria-live="polite">
      <div className="section-heading"><div><p className="eyebrow">YOUR LIBRARY</p><h2>Results</h2></div><span className="count-label">Page {page}</span></div>
      {loading && <LoadingState label="Searching…" />}
      {error && <><ErrorState>{error}</ErrorState><Button type="button" onClick={() => setApplied((current) => ({ ...current }))}>Try again</Button></>}
      {!loading && !error && memories.length === 0 && <div className="empty-card"><span className="empty-mark">⌕</span><h3>No memories found.</h3><p>Try a different phrase or remove a filter.</p><EmptyState>Search checks saved text, titles, and matching metadata.</EmptyState></div>}
      {memories.length > 0 && <MemoryFeed memories={memories} />}
      <div className="pagination"><Button type="button" disabled={page === 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</Button><span>Page {page}</span><Button type="button" disabled={!hasMore || loading} onClick={() => setPage((current) => current + 1)}>Next</Button></div>
    </section>
  </>;
}
