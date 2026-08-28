import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlertingService } from '../alerting/alerting.service';
import { ErrorRateMonitor } from './error-rate.monitor';
import { MetricsConfig } from './metrics.config';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  providers: [
    MetricsService,
    {
      provide: ErrorRateMonitor,
      inject: [ConfigService, MetricsService, AlertingService],
      useFactory: (
        configService: ConfigService,
        metricsService: MetricsService,
        alertingService: AlertingService,
      ): ErrorRateMonitor => {
        const config = configService.getOrThrow<MetricsConfig>('metrics');
        return new ErrorRateMonitor(
          configService,
          metricsService,
          alertingService,
          config,
        );
      },
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
