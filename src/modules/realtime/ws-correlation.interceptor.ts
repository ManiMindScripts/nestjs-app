import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { CorrelationService } from '../../shared/correlation/correlation.service';
import type { AuthedSocket } from '../../common/guards/ws-jwt.guard';

/**
 * Wraps every socket message handler in a correlation context so log lines
 * emitted from handler bodies (e.g. permission checks) carry the session's id.
 *
 * AsyncLocalStorage does NOT persist across the fresh per-event callbacks that
 * Socket.IO invokes, so a context established at connection time would be lost
 * by the time a handler runs. Each handled event therefore re-enters the
 * context explicitly, reusing the id that WsJwtGuard persisted on the socket.
 */
@Injectable()
export class WsCorrelationInterceptor implements NestInterceptor {
  constructor(private readonly correlationService: CorrelationService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const client = context.switchToWs().getClient<AuthedSocket>();
    const id = client.data?.correlationId ?? this.correlationService.generate();

    return this.correlationService.run(id, () => next.handle());
  }
}
