import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
}

describe('GlobalExceptionFilter envelope (DESIGN §4.3)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
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
});
