import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { MemoryDetailPage } from './MemoryDetailPage';
import { memoryApi } from '../../services/api/memory-api';
import { ApiError } from '../../services/api/client';

vi.mock('../../services/api/memory-api', () => ({ memoryApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), get: vi.fn(), update: vi.fn(), revisit: vi.fn() } }));
afterEach(cleanup);
const item = { id: '00000000-0000-4000-8000-000000000001', captureType: 'text' as const, title: 'Saved title', selectedText: 'Remember this', manualNote: null, sourceUrl: null, pageTitle: null, domain: null, tags: [], topic: null, language: null, isCode: false, codeLanguage: null, clientCreatedAt: null, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z', lastRevisitedAt: null, revisitCount: 0, version: 2 };
beforeEach(() => {
  vi.mocked(memoryApi.get).mockReset().mockResolvedValue({ memory: item });
  vi.mocked(memoryApi.revisit).mockReset().mockResolvedValue({ memory: { ...item, revisitCount: 1 } });
  vi.mocked(memoryApi.update).mockReset();
});
function page() { return <MemoryRouter initialEntries={[`/memories/${item.id}`]}><Routes><Route path="/memories/:id" element={<MemoryDetailPage />} /><Route path="/dashboard" element={<p>Library</p>} /></Routes></MemoryRouter>; }

describe('memory detail', () => {
  it('loads details and records an intentional revisit once', async () => {
    render(page());
    expect(await screen.findByText('Remember this')).toBeInTheDocument();
    await waitFor(() => expect(memoryApi.revisit).toHaveBeenCalledOnce());
  });
  it('uses the current version for edits and asks for reload on a stale conflict', async () => {
    vi.mocked(memoryApi.update).mockRejectedValue(new ApiError(409, 'VERSION_CONFLICT', 'This memory changed. Refresh and try again.', 'conflict'));
    render(page());
    await screen.findByText('Remember this');
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('This memory changed while you were editing.')).toBeInTheDocument();
    await waitFor(() => expect(memoryApi.update).toHaveBeenCalledWith(item.id, 2, expect.objectContaining({ title: 'Changed title' })));
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
    await waitFor(() => expect(memoryApi.get).toHaveBeenCalledTimes(2));
  });
});
