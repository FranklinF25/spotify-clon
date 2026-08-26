import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/atoms/Button/Button';
import { FormField, type FieldIssue } from '@/components/molecules/FormField/FormField';
import { loginSchema } from '@/lib/zod-schemas/login';
import { ApiError } from '@/lib/api/http-client';
import { useAuthStore } from '@/store/auth.store';
import { useToast } from '@/components/organisms/ToastHost/toast.store';

interface LocationState {
  from?: { pathname: string };
}

/**
 * LoginPage (REQ-FE-007). Owns the THIRD error-routing seam (DESIGN §9):
 * form-level try/catch around `authStore.login`. zod runs FIRST — an invalid
 * submission is rejected inline BEFORE any request. VALIDATION_ERROR maps
 * `details[].field` onto `FormField`; UNAUTHORIZED becomes a generic inline
 * form error (bad credentials aren't field-specific); other codes toast.
 *
 * On success the form navigates to `location.state?.from ?? '/home'` (R2-8: a
 * deep-link to a protected route while logged out returns there after login;
 * the default target is the app home — `/` is the public landing).
 */
export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as LocationState | null)?.from?.pathname ?? '/home';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [issues, setIssues] = useState<Record<string, FieldIssue>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // zod FIRST — block invalid submissions before any network call.
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const flat: Record<string, FieldIssue> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !flat[field]) {
          flat[field] = { message: issue.message };
        }
      }
      setIssues(flat);
      return;
    }
    setIssues({});

    try {
      await login(parsed.data);
      navigate(from, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'VALIDATION_ERROR') {
          const flat: Record<string, FieldIssue> = {};
          for (const detail of error.details) {
            flat[detail.field] = { message: detail.issue };
          }
          setIssues(flat);
        } else if (error.code === 'UNAUTHORIZED') {
          // Bad credentials aren't tied to a single field — surface a generic
          // inline form error. The form owns it; no toast.
          setFormError('Invalid email or password');
        } else {
          useToast.getState().push({ code: error.code, message: error.message });
        }
      } else {
        throw error;
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1>Sign in</h1>
      <FormField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        issue={issues.email}
      />
      <FormField
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        issue={issues.password}
      />
      {formError ? (
        <p role="alert" aria-label="Invalid credentials">
          {formError}
        </p>
      ) : null}
      <Button type="submit">Sign in</Button>
    </form>
  );
}
