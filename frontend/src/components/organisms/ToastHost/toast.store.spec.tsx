import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useToast } from './toast.store';
import { ToastHost } from './ToastHost';

/**
 * FE-PR2-01 — toast store + ToastHost organism (DESIGN §9).
 * Asserts push/dismiss semantics + the a11y `aria-live` region contract.
 * Toast store is cleared between tests by the global `resetStores` (setup.ts).
 */

describe('toast.store', () => {
  it('push adds a toast with a generated id + dismiss removes it', () => {
    useToast.getState().push({ code: 'NOT_FOUND', message: 'nope' });
    const [first] = useToast.getState().toasts;
    expect(first.code).toBe('NOT_FOUND');
    expect(first.message).toBe('nope');
    expect(typeof first.id).toBe('string');

    useToast.getState().dismiss(first.id);
    expect(useToast.getState().toasts).toHaveLength(0);
  });

  it('dismiss of an unknown id is a no-op', () => {
    useToast.getState().push({ code: 'NOT_FOUND', message: 'x' });
    useToast.getState().dismiss('does-not-exist');
    expect(useToast.getState().toasts).toHaveLength(1);
  });
});

describe('ToastHost organism', () => {
  it('renders an aria-live=polite region with one role=status per toast', () => {
    useToast.getState().push({ code: 'NOT_FOUND', message: 'Album not found' });
    useToast.getState().push({ code: 'UNKNOWN', message: 'Something broke' });
    render(<ToastHost />);

    const region = screen.getByLabelText('Notifications');
    expect(region).toHaveAttribute('aria-live', 'polite');

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(2);
    expect(screen.getByText('Album not found')).toBeInTheDocument();
    expect(screen.getByText('Something broke')).toBeInTheDocument();
  });

  it('dismiss button removes the toast from the region', () => {
    useToast.getState().push({ code: 'NOT_FOUND', message: 'temp' });
    render(<ToastHost />);
    expect(screen.getByText('temp')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('temp')).not.toBeInTheDocument();
  });

  it('renders nothing visible when there are no toasts', () => {
    render(<ToastHost />);
    expect(screen.queryAllByRole('status')).toHaveLength(0);
  });
});
