import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppLogger } from './logger';
import { GlobalExceptionFilter } from './exception.filter';
import { ConflictError } from './shared/errors/conflict-error';
import { UnauthorizedError } from './shared/errors/unauthorized-error';
import { ValidationError } from './shared/errors/validation-error';

@Controller('errors')
class ThrowingController {
  @Get('validation')
  validation(): never {
    throw new ValidationError('Invalid input', [{ field: 'email', issue: 'invalid_format' }]);
  }

  @Get('unauthorized')
  unauthorized(): never {
    throw new UnauthorizedError('Bad credentials');
  }

  @Get('conflict')
  conflict(): never {
    throw new ConflictError('Email already registered');
  }

  @Get('boom')
  boom(): never {
    throw new Error('something went very wrong');
  }
}

describe('GlobalExceptionFilter envelope (DESIGN §4.3)', () => {
  let app: INestApplication;
  let logger: AppLogger;

  beforeAll(async () => {
    logger = { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), verbose: vi.fn() } as unknown as AppLogger;
    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter(logger));
    await app.init();
  });

  beforeEach(() => {
    (logger.error as ReturnType<typeof vi.fn>).mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('shapes validation errors with code + message + details at HTTP 400', async () => {
    const res = await request(app.getHttpServer()).get('/errors/validation');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: [{ field: 'email', issue: 'invalid_format' }],
      },
    });
  });

  it('shapes unauthorized errors with code only (no details) at HTTP 401', async () => {
    const res = await request(app.getHttpServer()).get('/errors/unauthorized');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Bad credentials' } });
    expect(res.body.error).not.toHaveProperty('details');
  });

  it('shapes conflict errors with code only (no details) at HTTP 409', async () => {
    const res = await request(app.getHttpServer()).get('/errors/conflict');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'Email already registered' } });
    expect(res.body.error).not.toHaveProperty('details');
  });

  it('returns 500 INTERNAL_ERROR for unexpected exceptions and never leaks the original message', async () => {
    const res = await request(app.getHttpServer()).get('/errors/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(res.text).not.toContain('something went very wrong');
  });

  it('logs unexpected exceptions with the original error so 500s are never swallowed silently', async () => {
    await request(app.getHttpServer()).get('/errors/boom');

    expect(logger.error).toHaveBeenCalledTimes(1);
    // String-first AppLogger convention: error(message, ...optional). The
    // requestId is attached automatically by the ALS child logger, so the
    // filter must NOT pass it manually.
    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled exception',
      expect.objectContaining({
        err: expect.any(Error),
        path: '/errors/boom',
      }),
    );
    const [, payload] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      { err: Error },
    ];
    expect(payload.err.message).toBe('something went very wrong');
  });
});
