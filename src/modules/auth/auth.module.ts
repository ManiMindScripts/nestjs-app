import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAuthModule } from '../../common/auth/common-auth.module';
import { DurationLike, JwtConfig } from '../../config/jwt.config';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { MailService } from './mail/mail.service';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, PasswordResetToken]),
    // Global so both REST (JwtAccessStrategy) and WS (WsJwtGuard) share one
    // registration of the access-token secret and expiry.
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const jwtConfig = configService.getOrThrow<JwtConfig>('jwt');
        return {
          secret: jwtConfig.accessSecret,
          signOptions: {
            expiresIn: jwtConfig.accessExpiresIn as DurationLike,
          },
        };
      },
    }),
    UsersModule,
    CommonAuthModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAccessStrategy, MailService],
})
export class AuthModule {}
