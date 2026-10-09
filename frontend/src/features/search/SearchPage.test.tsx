import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SearchPage } from './SearchPage';
import { searchMemories } from '../../services/api/search-api';

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
  it('debounces the query and ignores stale requests', async () => {
    render(<MemoryRouter><SearchPage /></MemoryRouter>);
    const search = screen.getByLabelText('Search');
    fireEvent.change(search, { target: { value: 'distributed systems' } });
    await waitFor(() => expect(searchMemories).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'distributed systems' })), { timeout: 1500 });
  });
});
