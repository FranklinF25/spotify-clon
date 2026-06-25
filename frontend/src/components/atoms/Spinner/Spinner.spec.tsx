import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from './Spinner';

/**
 * FE-PR3-01 — Spinner atom (DESIGN §7, §11.1).
 * Pure presentational loading indicator. Used by HomePage loading state
 * (FE-PR3-12) + anywhere a query is pending. `role="status"` + `aria-label`
 * so assistive tech announces the loading state.
 */
describe('Spinner atom', () => {
  it('renders with role=status announcing loading to assistive tech', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('uses a sensible default accessible name', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading');
  });

  it('honours a custom aria-label when provided', () => {
    render(<Spinner aria-label="Loading albums" />);
    expect(
      screen.getByRole('status', { name: /loading albums/i }),
    ).toBeInTheDocument();
  });
});
