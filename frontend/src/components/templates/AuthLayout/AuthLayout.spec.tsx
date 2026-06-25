import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthLayout } from './AuthLayout';

/**
 * FE-PR2-09 — AuthLayout template (REQ-FE-008). Structural layout — verified
 * transitively by the router spec (FE-PR2-10). Light spec asserts the public
 * shell contract: a centered `<main>` landmark hosting the form, with NO
 * Sidebar/Topbar/PlayerBar (those belong to AppLayout only).
 */
describe('AuthLayout template', () => {
  it('renders its children inside a main landmark', () => {
    render(
      <AuthLayout>
        <form>
          <button type="submit">submit</button>
        </form>
      </AuthLayout>,
    );
    const main = screen.getByRole('main');
    expect(main).toBeInTheDocument();
    expect(main).toContainElement(screen.getByRole('button', { name: 'submit' }));
  });
});
