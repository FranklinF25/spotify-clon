import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Text } from './Text';

/**
 * Minimal atom spec (DESIGN §7). PR-2 needs Text (FormField renders the
 * inline issue message through it). Asserts the polymorphic `as` contract +
 * children rendering — no CSS-class coupling (strict-tdd rules).
 */
describe('Text atom', () => {
  it('renders its children', () => {
    render(<Text>hello world</Text>);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders as the requested element via `as`', () => {
    render(<Text as="label">Email</Text>);
    expect(screen.getByText('Email').tagName).toBe('LABEL');
  });
});
