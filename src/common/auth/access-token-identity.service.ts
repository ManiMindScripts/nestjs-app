import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '../constants/user-status.enum';
import { UsersService } from '../../modules/users/users.service';
import { User } from '../../modules/users/entities/user.entity';
import type { JwtPayload } from '../../modules/auth/strategies/jwt-access.strategy';

@Injectable()
export class AccessTokenIdentityService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async findActiveUserById(sub: string): Promise<User> {
    const user = await this.usersService.findById(sub);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }
    return user;
  }

  async verifyToken(token: string): Promise<User> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    if (!payload?.sub) {
      throw new UnauthorizedException('Invalid access token');
    }

    return this.findActiveUserById(payload.sub);
  }
}
