import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { MailModule } from '../auth/mail/mail.module';
import { HealthController } from './health.controller';

@Module({
  imports: [RealtimeModule, MailModule],
  controllers: [HealthController],
})
export class HealthModule {}
