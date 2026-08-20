import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import { AccessTokenIdentityService } from '../auth/access-token-identity.service';
import type { User } from '../../modules/users/entities/user.entity';

export interface AuthedSocket extends Socket {
  data: { user: User };
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  // Reuses AccessTokenIdentityService so REST (JwtAccessStrategy) and WS share
  // the exact same token -> active user resolution.
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly accessTokenIdentityService: AccessTokenIdentityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<AuthedSocket>();
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn(
        `WS connection without an access token denied (socket=${client.id})`,
      );
      client.disconnect(true);
      return false;
    }

    try {
      const user = await this.accessTokenIdentityService.verifyToken(token);
      client.data.user = user;
      return true;
    } catch (error) {
      this.logger.warn(
        `WS authentication failed (socket=${client.id})`,
        error instanceof Error ? error.message : String(error),
      );
      client.disconnect(true);
      return false;
    }
  }

  private extractToken(client: AuthedSocket): string | undefined {
    const authToken = (client.handshake.auth as { token?: string } | undefined)
      ?.token;
    if (authToken) {
      return authToken;
    }

    const authorization = client.handshake.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length);
    }

    return undefined;
  }
}
