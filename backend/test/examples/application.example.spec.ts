import { describe, expect, it } from 'vitest';

/**
 * Illustrative application-layer test.
 *
 * Shows the portfolio pattern: a use case depends only on a driven `*Port`
 * interface, and a hand-written in-memory fake stands in for the adapter —
 * no DI framework, no `vi.mock`. Real identity use-case specs land in PR-2.
 */
interface NameRepositoryPort {
  find(): Promise<string | null>;
  save(name: string): Promise<void>;
}

class InMemoryNameRepository implements NameRepositoryPort {
  constructor(private name: string | null = null) {}

  async find(): Promise<string | null> {
    return this.name;
  }

  async save(name: string): Promise<void> {
    this.name = name;
  }
}

class GreetUseCase {
  constructor(private readonly names: NameRepositoryPort) {}

  async execute(name: string): Promise<string> {
    await this.names.save(name);
    const stored = await this.names.find();
    return stored ? `Hello, ${stored}!` : 'Hello, stranger!';
  }
}

describe('application layer example (use case + in-memory port fake)', () => {
  it('greets the name persisted through the port', async () => {
    const useCase = new GreetUseCase(new InMemoryNameRepository());
    expect(await useCase.execute('Alice')).toBe('Hello, Alice!');
  });

  it('returns a default greeting when the port holds nothing', async () => {
    const useCase = new GreetUseCase(new InMemoryNameRepository(null));
    expect(await useCase.execute('Alice')).toBe('Hello, Alice!');
  });
});
