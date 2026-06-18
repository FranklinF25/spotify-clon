import { Controller, Get } from '@nestjs/common';

/**
 * Liveness/readiness probe.
 *
 * Mounted at `/health` (outside the `/api/v1` versioned prefix in bootstrap so
 * load balancers can probe it without version coupling). Returns a fixed
 * healthy payload — deep dependency checks (DB, etc.) are intentionally out of
 * scope for this foundation slice.
 */
@Controller('health')
export class HealthController {
  @Get()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
