import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SearchPage } from './SearchPage';
import { searchMemories } from '../../services/api/search-api';
import type { Memory, SearchResponse } from '@memdev/contracts';

vi.mock('../../services/api/search-api', () => ({ searchMemories: vi.fn() }));
afterEach(cleanup);
beforeEach(() => vi.mocked(searchMemories).mockReset().mockResolvedValue({ memories: [], page: 1, limit: 20, hasMore: false, nextPage: null }));

describe('memory search', () => {
  it('shows the no-results state and sends supported filters to the search API', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>);
    expect(await screen.findByText('No memories found.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'example.com' } });
    fireEvent.change(screen.getByLabelText('Tags (comma separated)'), { target: { value: 'typescript, api' } });
    fireEvent.change(screen.getByLabelText('Capture type'), { target: { value: 'url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(searchMemories).toHaveBeenLastCalledWith(expect.objectContaining({ domain: 'example.com', tags: ['typescript', 'api'], capture_type: 'url', page: 1, limit: 20 })));
  });
  it('debounces query text and ignores stale search responses', async () => {
    const memory = (title: string): Memory => ({ id: title === 'Newest result' ? '00000000-0000-4000-8000-000000000002' : '00000000-0000-4000-8000-000000000001', captureType: 'text', title, selectedText: title, manualNote: null, sourceUrl: null, pageTitle: null, domain: null, tags: [], topic: null, language: null, isCode: false, codeLanguage: null, clientCreatedAt: null, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z', lastRevisitedAt: null, revisitCount: 0, version: 1 });
    let resolveOld!: (result: SearchResponse) => void;
    let resolveNew!: (result: SearchResponse) => void;
    vi.mocked(searchMemories).mockImplementation((filters) => {
      if (filters?.q === 'old query') return new Promise((resolve) => { resolveOld = resolve; });
      if (filters?.q === 'new query') return new Promise((resolve) => { resolveNew = resolve; });
      return Promise.resolve({ memories: [], page: 1, limit: 20, hasMore: false, nextPage: null });
    });
    render(<MemoryRouter><SearchPage /></MemoryRouter>);
    const search = screen.getByLabelText('Search');
    fireEvent.change(search, { target: { value: 'old query' } });
    await waitFor(() => expect(searchMemories).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'old query' })), { timeout: 1500 });
    fireEvent.change(search, { target: { value: 'new query' } });
    await waitFor(() => expect(searchMemories).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'new query' })), { timeout: 1500 });
    resolveNew({ memories: [memory('Newest result')], page: 1, limit: 20, hasMore: false, nextPage: null });
    expect(await screen.findAllByText('Newest result')).toHaveLength(2);
    resolveOld({ memories: [memory('Old result')], page: 1, limit: 20, hasMore: false, nextPage: null });
    await waitFor(() => expect(screen.queryByText('Old result')).not.toBeInTheDocument());
  });
});
