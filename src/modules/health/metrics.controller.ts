import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PermissionAction } from '../../common/constants/permissions.enum';
import { PermissionSubject } from '../../common/constants/permission-subjects';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ConfigService } from '@nestjs/config';
import type { MetricsConfig } from '../../shared/metrics/metrics.config';
import { ErrorRateMonitor } from '../../shared/metrics/error-rate.monitor';
import {
  MetricsService,
  type MetricsSnapshot,
} from '../../shared/metrics/metrics.service';

@ApiTags('metrics')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Requires manage:Metric' })
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly errorRateMonitor: ErrorRateMonitor,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @SkipThrottle()
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.METRIC,
  })
  @ApiOperation({ summary: 'Application metrics snapshot (admin)' })
  @ApiOkResponse({ description: 'Metrics snapshot' })
  metrics(): MetricsSnapshot {
    // Re-evaluate the alert threshold on each read so the endpoint reflects
    // current state; the periodic monitor keeps alerting active in between.
    this.errorRateMonitor.check();
    const windowMs =
      this.configService.getOrThrow<MetricsConfig>('metrics').windowMs;
    return this.metricsService.snapshot(windowMs);
  }
}
