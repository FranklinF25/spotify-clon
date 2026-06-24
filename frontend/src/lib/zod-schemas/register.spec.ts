import { registerSchema } from './register';

describe('registerSchema', () => {
  it('parses a valid register payload', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.co',
      password: 'password1',
      displayName: 'Alice',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a short password with a field-level issue on password', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.co',
      password: 'short',
      displayName: 'Alice',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const passwordIssue = result.error.issues.find((i) =>
        i.path.includes('password'),
      );
      // REQ-FE-004 "zod mirror rejects a short password with a field-level issue".
      expect(passwordIssue).toBeDefined();
      // Literal message — FormField (FE-PR2-06) renders this verbatim inline.
      expect(passwordIssue?.message).toBe(
        'password must be at least 8 characters',
      );
    }
  });

  it('rejects an invalid email with an issue on the email field', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      password: 'password1',
      displayName: 'Alice',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('email')),
      ).toBe(true);
    }
  });

  it('rejects an empty displayName', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.co',
      password: 'password1',
      displayName: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('displayName')),
      ).toBe(true);
    }
  });
});
