import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api/http-client';
import type { TrackSummary } from '@/types/api';
import { AddTrackPicker } from './AddTrackPicker';

/**
 * FE-PR5 — AddTrackPicker molecule (REQ-FE-015 UX fix: search-to-add
 * replaces the paste-a-track-UUID form).
 *
 * Presentational: the molecule owns ONLY the debounce + local UI state and
 * honest error surfacing. Search + add are delegated to the parent through
 * the `onSearch`/`onAdd` props, so the spec injects `vi.fn()` fakes — no
 * MSW at this layer (the HTTP contract is covered by use-search.spec /
 * use-add-track.spec / the page spec).
 *
 * Fake timers drive the ~300ms debounce deterministically; promise
 * microtasks are NOT faked, so `await act(async () => {})` flushes each
 * onSearch/onAdd resolution before assertions.
 */
const RESULTS: TrackSummary[] = [
  { id: 'T1', title: 'Found Track', durationSeconds: 185, albumId: 'A1' },
  { id: 'T2', title: 'Second Hit', durationSeconds: 61, albumId: 'A1' },
];

/** Minimal manual deferred — a controllable pending promise. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup({
  onSearch,
  onAdd,
  isAddPending,
}: {
  onSearch?: (q: string) => Promise<TrackSummary[]> | TrackSummary[];
  onAdd?: (trackId: string) => Promise<unknown>;
  isAddPending?: boolean;
} = {}) {
  const search = onSearch ?? vi.fn().mockResolvedValue(RESULTS);
  const add = onAdd ?? vi.fn().mockResolvedValue(undefined);
  const view = render(
    <AddTrackPicker
      onSearch={search}
      onAdd={add}
      isAddPending={isAddPending}
    />,
  );
  return { search, add, view };
}

const typeQuery = (value: string) =>
  fireEvent.change(screen.getByLabelText(/search tracks/i), {
    target: { value },
  });

/** Fire the debounce window, then flush pending microtasks. */
const advanceDebounce = async (ms = 300) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('AddTrackPicker — debounce contract (REQ-FE-015)', () => {
  it('does NOT search before the 300ms window elapses, then searches once', async () => {
    const { search } = setup();
    typeQuery('found');
    await advanceDebounce(299);
    expect(search).not.toHaveBeenCalled();
    await advanceDebounce(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('found');
  });

  it('retimes when the query changes mid-debounce (one search, final value)', async () => {
    const { search } = setup();
    typeQuery('fou');
    await advanceDebounce(200);
    typeQuery('found');
    // 200 + 299 < 300ms since the LAST keystroke — still nothing.
    await advanceDebounce(299);
    expect(search).not.toHaveBeenCalled();
    await advanceDebounce(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('found');
  });

  it('clears the pending debounce timer on unmount', async () => {
    const { search, view } = setup();
    typeQuery('found');
    view.unmount();
    await advanceDebounce(400);
    expect(search).not.toHaveBeenCalled();
  });

  it('skips the search entirely for an empty or whitespace-only query', async () => {
    const { search } = setup();
    typeQuery('   ');
    await advanceDebounce(400);
    expect(search).not.toHaveBeenCalled();
    // No results list AND no premature "no results" state.
    expect(screen.queryByLabelText(/track results/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no tracks found/i)).not.toBeInTheDocument();
  });

  it('discards a stale slow response after the query moves on', async () => {
    const slow = deferred<TrackSummary[]>();
    const search = vi.fn(
      (q: string) => (q === 'slow' ? slow.promise : Promise.resolve(RESULTS)),
    );
    setup({ onSearch: search });

    typeQuery('slow');
    await advanceDebounce();
    expect(search).toHaveBeenCalledWith('slow');

    typeQuery('fast');
    await advanceDebounce();
    expect(screen.getByText('Found Track')).toBeInTheDocument();

    // The abandoned 'slow' response resolves LAST — it must NOT clobber.
    await act(async () => {
      slow.resolve([{ id: 'X', title: 'Stale', durationSeconds: 1, albumId: 'A' }]);
    });
    expect(screen.getByText('Found Track')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });
});

describe('AddTrackPicker — results rendering (REQ-FE-015)', () => {
  it('renders title + formatted duration per result (TrackSummary has NO artist field)', async () => {
    setup();
    typeQuery('found');
    await advanceDebounce();
    expect(screen.getByText('Found Track')).toBeInTheDocument();
    expect(screen.getByText('3:05')).toBeInTheDocument(); // 185s → m:ss
    expect(screen.getByText('Second Hit')).toBeInTheDocument();
    expect(screen.getByText('1:01')).toBeInTheDocument(); // 61s → m:ss
  });

  it('renders the explicit no-results state when the search resolves empty', async () => {
    setup({ onSearch: vi.fn().mockResolvedValue([]) });
    typeQuery('zzz');
    await advanceDebounce();
    expect(screen.getByText(/no tracks found/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/track results/i)).not.toBeInTheDocument();
  });

  it('surfaces an honest message when onSearch rejects', async () => {
    setup({ onSearch: vi.fn().mockRejectedValue(new Error('boom')) });
    typeQuery('found');
    await advanceDebounce();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not search/i);
  });
});

describe('AddTrackPicker — add contract (REQ-FE-015)', () => {
  it('calls onAdd(trackId) when a result Add button is clicked', async () => {
    const { add } = setup();
    typeQuery('found');
    await advanceDebounce();
    fireEvent.click(screen.getByRole('button', { name: 'Add Found Track' }));
    await act(async () => {});
    expect(add).toHaveBeenCalledWith('T1');
  });

  it('surfaces 422 UNPROCESSABLE_ENTITY as "track not found"', async () => {
    setup({
      onAdd: vi.fn().mockRejectedValue(
        new ApiError('UNPROCESSABLE_ENTITY', 'unknown track', 422),
      ),
    });
    typeQuery('found');
    await advanceDebounce();
    fireEvent.click(screen.getByRole('button', { name: 'Add Found Track' }));
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent(/track not found/i);
  });

  it('surfaces 403 FORBIDDEN as the non-owner message', async () => {
    setup({
      onAdd: vi.fn().mockRejectedValue(
        new ApiError('FORBIDDEN', 'not yours', 403),
      ),
    });
    typeQuery('found');
    await advanceDebounce();
    fireEvent.click(screen.getByRole('button', { name: 'Add Found Track' }));
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent(
      /you are not the owner of this playlist/i,
    );
  });

  it('surfaces a non-ApiError rejection as a generic message', async () => {
    setup({ onAdd: vi.fn().mockRejectedValue(new Error('boom')) });
    typeQuery('found');
    await advanceDebounce();
    fireEvent.click(screen.getByRole('button', { name: 'Add Found Track' }));
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent(/could not add track/i);
  });

  it('disables every Add button while the parent mutation is pending', async () => {
    setup({ isAddPending: true });
    typeQuery('found');
    await advanceDebounce();
    expect(screen.getByRole('button', { name: 'Add Found Track' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Second Hit' })).toBeDisabled();
  });

  it('disables every Add button while a row-local add is in flight, then re-enables', async () => {
    const gate = deferred<void>();
    setup({ onAdd: vi.fn(() => gate.promise) });
    typeQuery('found');
    await advanceDebounce();

    fireEvent.click(screen.getByRole('button', { name: 'Add Found Track' }));
    // Own row pending (label switches to "Adding…") AND sibling rows locked.
    expect(screen.getByRole('button', { name: 'Add Found Track' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Second Hit' })).toBeDisabled();

    await act(async () => {
      gate.resolve();
    });
    expect(screen.getByRole('button', { name: 'Add Found Track' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add Second Hit' })).toBeEnabled();
  });
});
