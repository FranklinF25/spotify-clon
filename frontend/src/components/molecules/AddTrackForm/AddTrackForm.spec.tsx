import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api/http-client';
import { render } from '@/test/render';
import { AddTrackForm } from './AddTrackForm';

/**
 * FE-PR3-04 — AddTrackForm molecule (REQ-FE-015).
 *
 * Presentational: the molecule owns the zod gate (non-empty trackId blocked
 * PRE-submit) and honest error surfacing (422/403 message selection). The
 * mutation is delegated to the parent via `onSubmit`, so the spec injects a
 * `vi.fn()` — no MSW needed at this layer (the HTTP contract is covered by the
 * hook spec + the page spec).
 */
describe('AddTrackForm (REQ-FE-015)', () => {
  it('blocks an empty trackId BEFORE onSubmit is called', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AddTrackForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    await waitFor(() =>
      expect(screen.getByText(/track id is required/i)).toBeInTheDocument(),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('on success it calls onSubmit(trackId) and resets the input', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AddTrackForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/track id/i), {
      target: { value: 'T9' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('T9'));
    // input reset after success
    expect(screen.getByLabelText(/track id/i)).toHaveValue('');
  });

  it('surfaces a 422 UNPROCESSABLE_ENTITY (unknown trackId) honestly', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError('UNPROCESSABLE_ENTITY', 'unknown track', 422),
    );
    render(<AddTrackForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/track id/i), {
      target: { value: 'T-NOPE' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    await waitFor(() =>
      expect(screen.getByText(/track not found/i)).toBeInTheDocument(),
    );
  });

  it('surfaces a 403 FORBIDDEN (non-owner) honestly', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError('FORBIDDEN', 'not yours', 403),
    );
    render(<AddTrackForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/track id/i), {
      target: { value: 'T9' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add track/i }));
    await waitFor(() =>
      expect(screen.getByText(/you are not the owner/i)).toBeInTheDocument(),
    );
  });

  it('disables the submit button while a submission is pending', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AddTrackForm onSubmit={onSubmit} isPending />);
    expect(screen.getByRole('button', { name: /add track/i })).toBeDisabled();
  });
});
