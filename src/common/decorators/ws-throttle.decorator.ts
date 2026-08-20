import { SetMetadata } from '@nestjs/common';

export const WS_THROTTLE_KEY = 'ws_throttle';

export interface WsThrottleOptions {
  limit: number;
  windowMs: number;
}

export const WsThrottle = (options: WsThrottleOptions): MethodDecorator =>
  SetMetadata(WS_THROTTLE_KEY, options);
