import { Logger, UseGuards, UsePipes } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { assertPermissionRules } from '../../../common/casl/assert-permission-rules';
import { PermissionAction } from '../../../common/constants/permissions.enum';
import { PermissionSubject } from '../../../common/constants/permission-subjects';
import { WsThrottle } from '../../../common/decorators/ws-throttle.decorator';
import { WsJwtGuard } from '../../../common/guards/ws-jwt.guard';
import type { AuthedSocket } from '../../../common/guards/ws-jwt.guard';
import { WsThrottleGuard } from '../../../common/guards/ws-throttle.guard';
import { WsValidationPipe } from '../../../common/pipes/ws-validation.pipe';
import { PermissionsService } from '../../permissions/permissions.service';
import type { User } from '../../users/entities/user.entity';
import { BroadcastNotificationDto } from '../dto/broadcast-notification.dto';

const USER_ROOM_PREFIX = 'user:';

const userRoom = (userId: string): string => `${USER_ROOM_PREFIX}${userId}`;

@WebSocketGateway({
  namespace: 'notifications',
  transports: ['websocket', 'polling'],
})
@UseGuards(WsThrottleGuard)
@UsePipes(new WsValidationPipe())
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private readonly server: Server;

  constructor(private readonly permissionsService: PermissionsService) {}

  @UseGuards(WsJwtGuard)
  async handleConnection(
    @ConnectedSocket() socket: AuthedSocket,
  ): Promise<void> {
    await socket.join(userRoom(socket.data.user.id));
    this.logger.log(
      `WS connected socket=${socket.id} userId=${socket.data.user.id}`,
    );
  }

  handleDisconnect(@ConnectedSocket() socket: AuthedSocket): void {
    const userId: User['id'] | undefined = socket.data.user?.id;
    this.logger.log(
      `WS disconnected socket=${socket.id} userId=${userId ?? 'unknown'}`,
    );
  }

  @SubscribeMessage('notifications:broadcast')
  @UseGuards(WsJwtGuard)
  @WsThrottle({ limit: 10, windowMs: 60_000 })
  async broadcast(
    @MessageBody() dto: BroadcastNotificationDto,
    @ConnectedSocket() socket: AuthedSocket,
  ): Promise<{ ok: boolean }> {
    const ability = await this.permissionsService.getAbilityForUser(
      socket.data.user.id,
    );
    assertPermissionRules(ability, [
      {
        action: PermissionAction.MANAGE,
        subject: PermissionSubject.NOTIFICATION,
      },
    ]);

    this.broadcastToAll('notifications:new', dto);
    return { ok: true };
  }

  sendToUser(userId: string, event: string, payload: unknown): boolean {
    return this.server.to(userRoom(userId)).emit(event, payload);
  }

  broadcastToAll(event: string, payload: unknown): boolean {
    return this.server.emit(event, payload);
  }
}
