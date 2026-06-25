import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FormField } from './FormField';

/**
 * FE-PR2-06 — FormField molecule (DESIGN §7 + §11.1).
 * Composes Input + Text atoms; wires `aria-invalid` + `aria-describedby` to a
 * zod-issue-shaped `issue` so screen readers announce inline validation errors.
 */
describe('FormField molecule', () => {
  it('renders a label associated with the input', () => {
    render(
      <FormField
        id="email"
        label="Email"
        value=""
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.id).toBe('email');
  });

  it('with an issue: input is aria-invalid + message is aria-describedby-linked + text renders', () => {
    render(
      <FormField
        id="password"
        label="Password"
        value="short"
        onChange={vi.fn()}
        issue={{ message: 'password must be at least 8 characters' }}
      />,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBe('password-error');
    const message = screen.getByText('password must be at least 8 characters');
    expect(message).toHaveAttribute('id', 'password-error');
  });

  it('without an issue: no message renders and aria-invalid is absent', () => {
    render(
      <FormField id="email" label="Email" value="a@b.co" onChange={vi.fn()} />,
    );
    const input = screen.getByLabelText('Email');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
    // No error message element present.
    expect(document.getElementById('email-error')).toBeNull();
  });

  it('forwards value + onChange to the input', () => {
    const onChange = vi.fn();
    render(
      <FormField id="email" label="Email" value="abc" onChange={onChange} />,
    );
    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.value).toBe('abc');
    fireEvent.change(input, { target: { value: 'abcd' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('forwards the requested input type (e.g. password)', () => {
    render(
      <FormField
        id="password"
        label="Password"
        type="password"
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
});
