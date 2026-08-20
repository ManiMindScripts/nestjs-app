import { Module } from '@nestjs/common';
import { UsersModule } from '../../modules/users/users.module';
import { AccessTokenIdentityService } from './access-token-identity.service';

@Module({
  imports: [UsersModule],
  providers: [AccessTokenIdentityService],
  exports: [AccessTokenIdentityService],
})
export class CommonAuthModule {}
