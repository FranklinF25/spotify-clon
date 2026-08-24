import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@/test/render';
import { SaveToLibraryButton } from './SaveToLibraryButton';

/**
 * F6 WORK-PR3-03 — SaveToLibraryButton molecule (REQ-FE-017; DESIGN §9.5).
 * Presentational contract: the PAGE owns hooks + error state; the molecule
 * owns rendering. No heart icon exists in the IconName union — the existing
 * `library` icon is used; none is invented.
 */
afterEach(() => vi.clearAllMocks());

describe('SaveToLibraryButton (REQ-FE-017 presentational contract)', () => {
  it('renders the save label with aria-pressed=false when unsaved', () => {
    render(
      <SaveToLibraryButton
        isSaved={false}
        disabled={false}
        isPending={false}
        error={null}
        onToggle={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /save to library/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toBeEnabled();
  });

  it('renders the remove label with aria-pressed=true when saved', () => {
    render(
      <SaveToLibraryButton
        isSaved={true}
        disabled={false}
        isPending={false}
        error={null}
        onToggle={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /remove from library/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('is disabled while a mutation is pending', () => {
    render(
      <SaveToLibraryButton
        isSaved={false}
        disabled={false}
        isPending={true}
        error={null}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is disabled while the library cache boots (honest unknown)', () => {
    render(
      <SaveToLibraryButton
        isSaved={false}
        disabled={true}
        isPending={false}
        error={null}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders an inline role="alert" error when set', () => {
    render(
      <SaveToLibraryButton
        isSaved={false}
        disabled={false}
        isPending={false}
        error="Couldn't save — the album is no longer available"
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /couldn't save/i,
    );
  });

  it('renders no alert when error is null', () => {
    render(
      <SaveToLibraryButton
        isSaved={false}
        disabled={false}
        isPending={false}
        error={null}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fires onToggle on click', () => {
    const onToggle = vi.fn();
    render(
      <SaveToLibraryButton
        isSaved={false}
        disabled={false}
        isPending={false}
        error={null}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save to library/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
