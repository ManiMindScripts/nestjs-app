import { Module } from '@nestjs/common';
import { CommonAuthModule } from '../../common/auth/common-auth.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { RealtimeAdapterStatus } from './realtime-adapter.status';

@Module({
  imports: [CommonAuthModule, PermissionsModule],
  providers: [NotificationsGateway, RealtimeAdapterStatus],
  exports: [NotificationsGateway, RealtimeAdapterStatus],
})
export class RealtimeModule {}
