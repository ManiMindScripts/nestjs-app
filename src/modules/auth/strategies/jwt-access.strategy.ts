import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessTokenIdentityService } from '../../../common/auth/access-token-identity.service';
import { JwtConfig } from '../../../config/jwt.config';
import { User } from '../../users/entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly accessTokenIdentity: AccessTokenIdentityService,
  ) {
    const jwtConfig = configService.getOrThrow<JwtConfig>('jwt');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.accessSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<User | null> {
    if (!payload?.sub) {
      return null;
    }

    // Shares the active-user resolution with the WS path (WsJwtGuard) so REST
    // and sockets can never drift apart on what a valid identity is.
    return this.accessTokenIdentity.findActiveUserById(payload.sub);
  }
}
