import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/render';
import { LandingPage } from './LandingPage';

/**
 * LandingPage — the public root at `/` (REQ-FE-008 route split).
 *
 * Rendered through the MemoryRouter test wrapper with NO auth state: the
 * page is static + presentational (no store reads, no requests), so no MSW
 * setup is needed — a network call would only happen if the page regressed
 * into fetching, and the global setup would then fail the suite loudly.
 *
 * Covers:
 *  - the hero headline is the SINGLE h1 (landmark structure: banner/main/
 *    contentinfo all present).
 *  - every auth CTA routes correctly (register CTAs → /register, sign-in
 *    CTAs → /login — the page repeats them in header/hero/footer).
 *  - the copy is real product copy (Range requests, queue, library), with
 *    no placeholder text.
 *  - mount is console-error clean (catches broken Links / act warnings).
 */
describe('LandingPage — public marketing root', () => {
  it('renders the hero headline as the single h1', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /streaming app for the library you already own/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('links every register CTA to /register and every sign-in CTA to /login', () => {
    render(<LandingPage />);

    const register = screen.getAllByRole('link', { name: /create (your )?account/i });
    expect(register.length).toBeGreaterThanOrEqual(1);
    for (const link of register) {
      expect(link).toHaveAttribute('href', '/register');
    }

    const login = screen.getAllByRole('link', { name: /sign in/i });
    expect(login.length).toBeGreaterThanOrEqual(1);
    for (const link of login) {
      expect(link).toHaveAttribute('href', '/login');
    }
  });

  it('exposes the landmark structure (banner, main, footer, account nav)', () => {
    render(<LandingPage />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /account/i })).toBeInTheDocument();
  });

  it('renders real product copy — features, steps, legal line — not placeholders', () => {
    render(<LandingPage />);
    expect(
      screen.getByRole('heading', { name: /built like a product, not a demo/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /from zero to playing in three steps/i }),
    ).toBeInTheDocument();
    // Distinctive claims of THIS app ("206 Partial Content" intentionally
    // repeats across feature copy, marquee and panel — assert at least one).
    expect(screen.getByText(/seeds an explicit queue/i)).toBeInTheDocument();
    expect(screen.getAllByText(/206 Partial Content/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/music files supplied by the library owner/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/lorem ipsum/i)).not.toBeInTheDocument();
  });

  it('mounts without console errors', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<LandingPage />);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
