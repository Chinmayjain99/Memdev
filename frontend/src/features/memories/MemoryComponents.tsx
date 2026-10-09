import { Link } from 'react-router';
import type { Memory } from '@memdev/contracts';
import { Button } from '../../components/common/Button';

export function MemoryContent({ memory, expanded = false }: { memory: Memory; expanded?: boolean }) {
  const content = memory.selectedText || memory.manualNote || 'No saved excerpt.';
  return <div className="memory-content">
    {memory.title && <h3>{memory.title}</h3>}
    <p className={memory.isCode ? 'code-content' : expanded ? 'expanded-content' : ''}>{content}</p>
    {memory.manualNote && memory.selectedText && <p className="memory-note">{memory.manualNote}</p>}
    {memory.sourceUrl && <a href={memory.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}
  </div>;
}

export function MemoryTags({ tags }: { tags: string[] }) {
  return tags.length ? <ul className="tag-list" aria-label="Tags">{tags.map((tag) => <li key={tag}>{tag}</li>)}</ul> : null;
}

export function MemoryMetadata({ memory }: { memory: Memory }) {
  return <div className="memory-metadata">
    <span>{memory.captureType === 'url' ? 'Web page' : 'Text capture'}</span>
    {memory.domain && <span>{memory.domain}</span>}
    {memory.topic && <span>{memory.topic}</span>}
    {memory.language && <span>{memory.language}</span>}
    {memory.isCode && <span>{memory.codeLanguage || 'Code'}</span>}
    <time dateTime={memory.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(memory.createdAt))}</time>
  </div>;
}

export function MemoryActions({ memory, onDelete, deleting = false }: { memory: Memory; onDelete?: (id: string) => void; deleting?: boolean }) {
  async function copy() {
    await navigator.clipboard.writeText(memory.selectedText || memory.manualNote || memory.sourceUrl || '');
  }
  return <div className="memory-actions">
    <Link className="button" to={`/memories/${memory.id}`}>Open memory</Link>
    <Button type="button" onClick={() => void copy()} disabled={!memory.selectedText && !memory.manualNote && !memory.sourceUrl}>Copy</Button>
    {onDelete && <Button type="button" disabled={deleting} onClick={() => onDelete(memory.id)}>{deleting ? 'Deleting…' : 'Delete'}</Button>}
  </div>;
}

export function MemoryCard({ memory, onDelete, deleting }: { memory: Memory; onDelete?: (id: string) => void; deleting?: boolean }) {
  return <article className="memory-card">
    <MemoryContent memory={memory} />
    <MemoryTags tags={memory.tags} />
    <MemoryMetadata memory={memory} />
    <MemoryActions memory={memory} onDelete={onDelete} deleting={deleting} />
  </article>;
}

export function MemoryFeed({ memories, onDelete, deletingId }: { memories: Memory[]; onDelete?: (id: string) => void; deletingId?: string | null }) {
  return <div className="memory-feed">{memories.map((memory) => <MemoryCard key={memory.id} memory={memory} onDelete={onDelete} deleting={deletingId === memory.id} />)}</div>;
}

export function MemoryDetailPanel({ memory }: { memory: Memory }) {
  return <section className="panel detail-panel">
    <MemoryContent memory={memory} expanded />
    <MemoryTags tags={memory.tags} />
    <MemoryMetadata memory={memory} />
    <MemoryActions memory={memory} />
    <dl className="detail-facts">
      <div><dt>Saved</dt><dd><time dateTime={memory.createdAt}>{new Date(memory.createdAt).toLocaleString()}</time></dd></div>
      <div><dt>Last revisited</dt><dd>{memory.lastRevisitedAt ? new Date(memory.lastRevisitedAt).toLocaleString() : 'Not yet revisited'}</dd></div>
      <div><dt>Revisits</dt><dd>{memory.revisitCount}</dd></div>
      {memory.sourceUrl && <div><dt>Source</dt><dd><a href={memory.sourceUrl} target="_blank" rel="noreferrer">{memory.sourceUrl}</a></dd></div>}
    </dl>
  </section>;
}
