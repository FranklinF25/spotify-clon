import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Input } from './Input';

/**
 * Minimal atom spec (DESIGN §7). PR-2 needs Input (FormField composes it);
 * the full atom set lands in PR-3. Asserts forwarding + a11y wiring — the
 * contracts FormField relies on.
 */
describe('Input atom', () => {
  it('forwards value + onChange', () => {
    const onChange = vi.fn();
    render(<Input value="abc" onChange={onChange} aria-label="Email" />);
    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.value).toBe('abc');
    fireEvent.change(input, { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('forwards aria-invalid from props', () => {
    render(
      <Input aria-invalid="true" aria-label="Email" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  it('renders the requested input type', () => {
    render(
      <Input type="password" aria-label="Password" onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'type',
      'password',
    );
  });
});
