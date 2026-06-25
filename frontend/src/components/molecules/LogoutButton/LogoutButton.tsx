import { Button } from '@/components/atoms/Button/Button';

/**
 * LogoutButton molecule (REQ-FE-007, DESIGN §7).
 *
 * Presentational: renders a `<Button>` labelled "Log out" that calls `onLogout`
 * on click. Deliberately does NOT import `authStore` — the LOCKED architecture
 * rule (FE-PR1-13) forbids molecules from importing `store/`. The
 * `authStore.logout` wiring lands at the call site (Topbar, PR-3):
 *   `<LogoutButton onLogout={authStore(s => s.logout)} />`
 * All logout logic (POST /auth/logout, clear+redirect inside `finally` —
 * JD fix #4) lives in `authStore.logout`, NOT here.
 */
export function LogoutButton({ onLogout }: { onLogout: () => void }) {
  return (
    <Button variant="secondary" onClick={onLogout}>
      Log out
    </Button>
  );
}
