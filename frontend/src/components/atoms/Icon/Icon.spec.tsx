import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon } from './Icon';

/**
 * FE-PR3-01 — Icon atom (DESIGN §7, §11.1).
 * Pure presentational SVG. Owns no state, composes nothing. Used by Sidebar
 * (home/search), AlbumCard/TrackRow (play), and the "coming soon" stubs.
 * a11y: a labelled icon is announced; an unlabelled icon is aria-hidden so
 * screen readers skip it (the surrounding text label is the accessible name).
 */
describe('Icon atom', () => {
  it('renders an svg element for a known icon name', () => {
    const { container } = render(<Icon name="play" aria-label="Play" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('exposes the aria-label to assistive tech', () => {
    render(<Icon name="play" aria-label="Play album" />);
    expect(screen.getByRole('img', { name: /play album/i })).toBeInTheDocument();
  });

  it('is aria-hidden when no label is supplied (decorative icon)', () => {
    const { container } = render(<Icon name="play" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders different path content for different names (triangulation)', () => {
    const { container: playContainer } = render(
      <Icon name="play" aria-label="Play" />,
    );
    const { container: homeContainer } = render(
      <Icon name="home" aria-label="Home" />,
    );
    const playPath = playContainer.querySelector('svg path')?.getAttribute('d');
    const homePath = homeContainer.querySelector('svg path')?.getAttribute('d');
    expect(playPath).toBeTruthy();
    expect(homePath).toBeTruthy();
    expect(playPath).not.toBe(homePath);
  });
});
