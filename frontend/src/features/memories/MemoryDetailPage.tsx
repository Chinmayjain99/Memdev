import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Memory, UpdateMemoryRequest } from '@memdev/contracts';
import { ApiError } from '../../services/api/client';
import { memoryApi } from '../../services/api/memory-api';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { TextArea } from '../../components/common/TextArea';
import { ErrorState, LoadingState } from '../../components/common/States';
import { MemoryDetailPanel } from './MemoryComponents';

export function MemoryDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [memory, setMemory] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const visited = useRef(new Set<string>());

  async function reload() {
    setLoading(true); setError('');
    try { const result = await memoryApi.get(id); setMemory(result.memory); setConflict(false); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Could not load this memory.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setMemory(null);
    void memoryApi.get(id).then(async ({ memory: loaded }) => {
      if (!active) return;
      setMemory(loaded);
      if (!visited.current.has(id)) {
        visited.current.add(id);
        try { const result = await memoryApi.revisit(id); if (active) setMemory(result.memory); }
        catch { /* Opening the saved item should remain useful if tracking fails. */ }
      }
    }).catch((cause: unknown) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Could not load this memory.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  async function remove() {
    if (!window.confirm('Delete this memory? It will be moved to trash.')) return;
    try { await memoryApi.remove(id); navigate('/dashboard', { replace: true }); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Could not delete this memory.'); }
  }

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!memory) return;
    const data = new FormData(event.currentTarget);
    const tags = String(data.get('tags') ?? '').split(',').map((tag) => tag.trim()).filter(Boolean);
    const isCode = data.get('isCode') === 'on';
    const codeLanguage = String(data.get('codeLanguage') ?? '').trim();
    if (codeLanguage && !isCode) { setError('Clear the code language or mark this as code.'); return; }
    const patch: UpdateMemoryRequest = {
      title: String(data.get('title') ?? '').trim() || null,
      manualNote: String(data.get('manualNote') ?? '') || null,
      tags,
      topic: String(data.get('topic') ?? '').trim() || null,
      language: String(data.get('language') ?? '').trim() || null,
      isCode,
      codeLanguage: isCode ? codeLanguage || null : null,
    };
    setSaving(true); setError(''); setConflict(false);
    try { const result = await memoryApi.update(id, memory.version, patch); setMemory(result.memory); setEditing(false); }
    catch (cause) {
      if (cause instanceof ApiError && cause.kind === 'conflict') setConflict(true);
      else setError(cause instanceof ApiError ? cause.message : 'Could not save your changes.');
    } finally { setSaving(false); }
  }

  if (loading) return <LoadingState label="Opening your memory…" />;
  return <>
    <div className="page-heading"><div><p className="eyebrow">MEMORY DETAIL</p><h1>{memory?.title || 'A saved thought'}</h1></div><Link className="back-link" to="/dashboard">← Back to your library</Link></div>
    {error && <><ErrorState>{error}</ErrorState><Button type="button" onClick={() => void reload()}>Try again</Button></>}
    {conflict && <div className="conflict-box" role="alert"><div><strong>This memory changed while you were editing.</strong><p>Reload the latest version before making another change.</p></div><Button type="button" onClick={() => { setEditing(false); void reload(); }}>Reload latest</Button></div>}
    {memory && <>
      {!editing && <MemoryDetailPanel memory={memory} />}
      <div className="detail-toolbar">{!editing && <Button type="button" onClick={() => setEditing(true)}>Edit details</Button>}<Button type="button" onClick={() => void remove()}>Delete memory</Button></div>
      {editing && <section className="panel"><h2>Edit details</h2><form className="memory-form" onSubmit={(event) => void update(event)}>
        {memory.captureType === 'text' && <TextArea label="Saved text" name="selectedText" rows={5} value={memory.selectedText ?? ''} readOnly />}
        {memory.captureType === 'url' && <p className="hint">The saved page address and excerpt are read-only.</p>}
        <Input label="Title" name="title" maxLength={500} defaultValue={memory.title ?? ''} />
        <TextArea label="Your note" name="manualNote" rows={4} defaultValue={memory.manualNote ?? ''} />
        <div className="form-grid"><Input label="Tags (comma separated)" name="tags" defaultValue={memory.tags.join(', ')} /><Input label="Topic" name="topic" defaultValue={memory.topic ?? ''} /></div>
        <div className="form-grid"><Input label="Language" name="language" defaultValue={memory.language ?? ''} /><label className="check-field"><input name="isCode" type="checkbox" defaultChecked={memory.isCode} /> This is code</label></div>
        <Input label="Code language" name="codeLanguage" defaultValue={memory.codeLanguage ?? ''} />
        <div className="form-actions"><Button type="button" onClick={() => setEditing(false)}>Cancel</Button><Button className="primary action-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button></div>
      </form></section>}
    </>}
  </>;
}
