import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtConfig } from '../../../config/jwt.config';
import { UserStatus } from '../../../common/constants/user-status.enum';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
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

    const user = await this.usersService.findById(payload.sub);

    if (!user || user.status !== UserStatus.ACTIVE) {
      return null;
    }

    return user;
  }
}
