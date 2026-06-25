import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchBar } from './SearchBar';

/**
 * FE-PR3-04 — SearchBar molecule (REQ-FE-010, DESIGN §11.1).
 * Presentational: a `<form>` with a labelled `<input type="search">` + submit
 * button. Emits `onSubmit(q)` upward — the container page navigates to
 * /search?q=... Reads NO store (architecture rule). Keyboard-operable (Enter
 * submits) because it's a real form, not a div + onclick.
 */
describe('SearchBar molecule', () => {
  it('renders a labelled search input (getByLabelText)', () => {
    render(<SearchBar onSubmit={vi.fn()} />);
    const input = screen.getByLabelText(/search/i) as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('search');
  });

  it('calls onSubmit with the current value when the form is submitted (Enter)', () => {
    const onSubmit = vi.fn();
    render(<SearchBar onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/search/i);
    fireEvent.change(input, { target: { value: 'foo' } });
    fireEvent.submit(input.closest('form')!);
    expect(onSubmit).toHaveBeenCalledWith('foo');
  });

  it('prevents default form submission so the page controls navigation', () => {
    const onSubmit = vi.fn();
    render(<SearchBar onSubmit={onSubmit} />);
    const form = screen.getByLabelText(/search/i).closest('form')!;
    // fireEvent.submit returns whether preventDefault was called by a handler.
    const prevented = fireEvent.submit(form);
    expect(prevented).toBe(false); // RTL: false => a handler called preventDefault
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('accepts an initial value (pre-fill for the search page)', () => {
    render(<SearchBar initialValue="jazz" onSubmit={vi.fn()} />);
    const input = screen.getByLabelText(/search/i) as HTMLInputElement;
    expect(input.value).toBe('jazz');
  });
});
