import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { DashboardPage } from './DashboardPage';
import { memoryApi } from '../../services/api/memory-api';

vi.mock('../../services/api/memory-api', () => ({ memoryApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn(), get: vi.fn(), update: vi.fn(), revisit: vi.fn() } }));
afterEach(cleanup);
const item = { id: '00000000-0000-4000-8000-000000000001', captureType: 'text' as const, title: 'A saved idea', selectedText: 'Keep this thought', manualNote: null, sourceUrl: null, pageTitle: null, domain: null, tags: ['typescript'], topic: null, language: null, isCode: false, codeLanguage: null, clientCreatedAt: null, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z', lastRevisitedAt: null, revisitCount: 0, version: 1 };
beforeEach(() => {
  vi.mocked(memoryApi.list).mockReset().mockResolvedValue({ memories: [item], hasMore: false, nextCursor: null });
  vi.mocked(memoryApi.create).mockReset().mockResolvedValue({ memory: item });
  vi.mocked(memoryApi.remove).mockReset().mockResolvedValue(undefined);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
});

describe('dashboard memory feed', () => {
  it('loads and renders the authenticated memory feed', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText('Keep this thought')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(memoryApi.list).toHaveBeenCalledWith({ limit: 20, cursor: undefined });
  });
  it('shows the empty state and can retry a failed request', async () => {
    vi.mocked(memoryApi.list).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ memories: [], hasMore: false, nextCursor: null });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your memories.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Your first useful thing belongs here.')).toBeInTheDocument();
  });
  it('requests subsequent pages using the opaque server cursor', async () => {
    vi.mocked(memoryApi.list).mockResolvedValueOnce({ memories: [item], hasMore: true, nextCursor: 'cursor-1' }).mockResolvedValueOnce({ memories: [{ ...item, id: '00000000-0000-4000-8000-000000000002', title: 'Next page' }], hasMore: false, nextCursor: null });
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('Keep this thought');
    fireEvent.click(screen.getByRole('button', { name: 'Load more memories' }));
    expect(await screen.findByText('Next page')).toBeInTheDocument();
    await waitFor(() => expect(memoryApi.list).toHaveBeenLastCalledWith({ limit: 20, cursor: 'cursor-1' }));
  });
  it('creates a text memory through the centralized API using required selected text', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('Keep this thought');
    fireEvent.click(screen.getByRole('button', { name: '＋ Save a memory' }));
    fireEvent.change(screen.getByLabelText('Selected text'), { target: { value: 'A new snippet' } });
    fireEvent.change(screen.getByLabelText('Title (optional)'), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save memory' }));
    await waitFor(() => expect(memoryApi.create).toHaveBeenCalledWith(expect.objectContaining({ captureType: 'text', selectedText: 'A new snippet', title: 'New title' })));
    await waitFor(() => expect(memoryApi.list).toHaveBeenCalledTimes(2));
  });
  it('soft-deletes a memory after confirmation and removes it from the feed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter><DashboardPage /></MemoryRouter>);
    await screen.findByText('Keep this thought');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(memoryApi.remove).toHaveBeenCalledWith(item.id));
    await waitFor(() => expect(screen.queryByText('Keep this thought')).not.toBeInTheDocument());
  });
});
