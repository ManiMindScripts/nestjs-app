import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { MailModule } from '../auth/mail/mail.module';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [RealtimeModule, MailModule],
  controllers: [HealthController, MetricsController],
})
export class HealthModule {}
