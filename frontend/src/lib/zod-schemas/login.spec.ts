import { loginSchema } from './login';

describe('loginSchema', () => {
  it('parses a valid login payload', () => {
    expect(
      loginSchema.safeParse({ email: 'a@b.co', password: 'password1' })
        .success,
    ).toBe(true);
  });

  it('rejects a short password with an issue on password', () => {
    const result = loginSchema.safeParse({
      email: 'a@b.co',
      password: 'short',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('password')),
      ).toBe(true);
    }
  });

  it('rejects an invalid email with an issue on email', () => {
    const result = loginSchema.safeParse({
      email: 'nope',
      password: 'password1',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path.includes('email')),
      ).toBe(true);
    }
  });
});
