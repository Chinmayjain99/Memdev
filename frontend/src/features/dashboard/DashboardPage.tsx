import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { CreateMemoryRequest, Memory } from '@memdev/contracts';
import { ApiError } from '../../services/api/client';
import { memoryApi } from '../../services/api/memory-api';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { TextArea } from '../../components/common/TextArea';
import { ErrorState, LoadingState } from '../../components/common/States';
import { Modal } from '../../components/common/Modal';
import { MemoryFeed } from '../memories/MemoryComponents';

export function DashboardPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async (nextCursor?: string, append = false) => {
    if (append) setLoadingMore(true); else { setLoading(true); setError(''); }
    try {
      const page = await memoryApi.list({ limit: 20, cursor: nextCursor });
      setMemories((current) => append ? [...current, ...page.memories] : page.memories);
      setCursor(page.nextCursor); setHasMore(page.hasMore);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load your memories.');
    } finally { setLoading(false); setLoadingMore(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove(id: string) {
    if (!window.confirm('Delete this memory? It will be moved to trash.')) return;
    setDeletingId(id);
    try { await memoryApi.remove(id); setMemories((items) => items.filter((item) => item.id !== id)); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Could not delete this memory.'); }
    finally { setDeletingId(null); }
  }

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">YOUR LIBRARY</p><h1>Good things, saved.</h1><p className="page-intro">A quiet home for ideas you want to find again.</p></div>
      <Button className="primary action-button" type="button" onClick={() => setCreateOpen(true)}>＋ Save a memory</Button>
    </div>
    <section className="feed-section" aria-labelledby="feed-title">
      <div className="section-heading"><div><p className="eyebrow">RECENTLY CAPTURED</p><h2 id="feed-title">Your memories</h2></div><span className="count-label">{memories.length}{hasMore ? '+' : ''} saved</span></div>
      {error && <><ErrorState>{error}</ErrorState><Button type="button" onClick={() => void load()}>Try again</Button></>}
      {loading && <LoadingState label="Loading your memories…" />}
      {!loading && !error && memories.length === 0 && <div className="empty-card"><span className="empty-mark">✳</span><h3>Your first useful thing belongs here.</h3><p>Save a snippet, a thought, or a page worth revisiting.</p><Button className="primary action-button" type="button" onClick={() => setCreateOpen(true)}>Save your first memory</Button></div>}
      {memories.length > 0 && <MemoryFeed memories={memories} onDelete={(id) => void remove(id)} deletingId={deletingId} />}
      {hasMore && <div className="load-more"><Button type="button" disabled={loadingMore || !cursor} onClick={() => cursor && void load(cursor, true)}>{loadingMore ? 'Loading…' : 'Load more memories'}</Button></div>}
    </section>
    {createOpen && <CreateMemoryDialog onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await load(); }} />}
  </>;
}

function CreateMemoryDialog({ onClose, onCreated }: { onClose(): void; onCreated(): Promise<void> }) {
  const [type, setType] = useState<'text' | 'url'>('text');
  const [title, setTitle] = useState(''); const [selectedText, setSelectedText] = useState(''); const [sourceUrl, setSourceUrl] = useState('');
  const [manualNote, setManualNote] = useState(''); const [tags, setTags] = useState(''); const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState(''); const [isCode, setIsCode] = useState(false); const [codeLanguage, setCodeLanguage] = useState('');
  const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (type === 'text' && !selectedText.trim()) { setError('Add the selected text you want to remember.'); return; }
    if (type === 'url' && !/^https?:\/\//i.test(sourceUrl)) { setError('Enter a page address starting with http:// or https://.'); return; }
    if (codeLanguage.trim() && !isCode) { setError('Mark this as code before adding a code language.'); return; }
    const metadata = { title: title.trim() || null, manualNote: manualNote || null, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), topic: topic || null, language: language || null, isCode, codeLanguage: isCode ? codeLanguage || null : null };
    const input: CreateMemoryRequest = type === 'text'
      ? { ...metadata, captureType: 'text', selectedText: selectedText.trim() }
      : { ...metadata, captureType: 'url', sourceUrl: sourceUrl.trim(), selectedText: selectedText.trim() || null };
    setPending(true);
    try { await memoryApi.create(input); await onCreated(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Could not save this memory.'); }
    finally { setPending(false); }
  }
  return <Modal title="Save a memory" onClose={onClose}>
    <form className="memory-form" onSubmit={(event) => void submit(event)}>
      <div className="segmented" role="group" aria-label="Memory type"><button type="button" aria-pressed={type === 'text'} onClick={() => setType('text')}>Text snippet</button><button type="button" aria-pressed={type === 'url'} onClick={() => setType('url')}>Web page</button></div>
      {error && <ErrorState>{error}</ErrorState>}
      {type === 'url' && <Input label="Page URL" name="sourceUrl" type="url" required value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />}
      <TextArea label={type === 'text' ? 'Selected text' : 'Excerpt (optional)'} name="selectedText" required={type === 'text'} rows={5} value={selectedText} onChange={(event) => setSelectedText(event.target.value)} />
      <Input label="Title (optional)" name="title" maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} />
      <TextArea label="Your note (optional)" name="manualNote" rows={3} value={manualNote} onChange={(event) => setManualNote(event.target.value)} />
      <div className="form-grid"><Input label="Tags (comma separated)" name="tags" value={tags} onChange={(event) => setTags(event.target.value)} /><Input label="Topic" name="topic" value={topic} onChange={(event) => setTopic(event.target.value)} /></div>
      <div className="form-grid"><Input label="Language" name="language" value={language} onChange={(event) => setLanguage(event.target.value)} /><label className="check-field"><input type="checkbox" checked={isCode} onChange={(event) => setIsCode(event.target.checked)} /> This is code</label></div>
      {isCode && <Input label="Code language" name="codeLanguage" value={codeLanguage} onChange={(event) => setCodeLanguage(event.target.value)} />}
      <div className="form-actions"><Button type="button" onClick={onClose}>Cancel</Button><Button className="primary action-button" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save memory'}</Button></div>
    </form>
  </Modal>;
}
