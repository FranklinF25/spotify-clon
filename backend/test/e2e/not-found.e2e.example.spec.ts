import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GlobalExceptionFilter } from '../../src/exception.filter';

/**
 * Illustrative end-to-end test: a full request travels through the Nest
 * pipeline and the global exception filter, proving the `e2e` project runs.
 * Real identity HTTP specs land in PR-3.
 */
describe('e2e layer example (HTTP pipeline + envelope filter)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the DESIGN §4.3 NOT_FOUND envelope for an unknown route', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });
});
