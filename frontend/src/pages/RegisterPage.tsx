import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/atoms/Button/Button';
import { FormField, type FieldIssue } from '@/components/molecules/FormField/FormField';
import { registerSchema } from '@/lib/zod-schemas/register';
import { ApiError } from '@/lib/api/http-client';
import { useAuthStore } from '@/store/auth.store';
import { useToast } from '@/components/organisms/ToastHost/toast.store';

interface LocationState {
  from?: { pathname: string };
}

/**
 * RegisterPage (REQ-FE-007). Mirrors LoginPage with three fields. Owns the
 * form-level try/catch (DESIGN §9 third seam) around `authStore.register`:
 *  - zod (registerSchema) runs FIRST — invalid submissions are rejected inline
 *    BEFORE any request.
 *  - VALIDATION_ERROR → inline field errors via `details[].field`.
 *  - CONFLICT → inline on the email field ("email already exists"). The form
 *    owns it; the MutationCache onError filters CONFLICT so no toast is added
 *    either — single, inline, non-crashing UX.
 *  - other codes → toast.
 *
 * On success the form authenticates + navigates to `location.state?.from ?? '/'`.
 */
export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as LocationState | null)?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [issues, setIssues] = useState<Record<string, FieldIssue>>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // zod FIRST — block invalid submissions before any network call.
    const parsed = registerSchema.safeParse({ email, password, displayName });
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
      await register(parsed.data);
      navigate(from, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'VALIDATION_ERROR') {
          const flat: Record<string, FieldIssue> = {};
          for (const detail of error.details) {
            flat[detail.field] = { message: detail.issue };
          }
          setIssues(flat);
        } else if (error.code === 'CONFLICT') {
          // Inline on the email field — single, non-crashing, no toast
          // (MutationCache onError filters CONFLICT; the form owns it).
          setIssues({ email: { message: 'That email is already registered' } });
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
      <h1>Create account</h1>
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
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        issue={issues.password}
      />
      <FormField
        id="displayName"
        label="Display name"
        value={displayName}
        autoComplete="name"
        onChange={(e) => setDisplayName(e.target.value)}
        issue={issues.displayName}
      />
      <Button type="submit">Create account</Button>
    </form>
  );
}
