import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import {
  WS_THROTTLE_KEY,
  WsThrottleOptions,
} from '../decorators/ws-throttle.decorator';

const COUNTER_KEY = '_wsThrottle';

interface ThrottleEntry {
  count: number;
  resetAt: number;
}

type ThrottleState = Record<string, ThrottleEntry>;

@Injectable()
export class WsThrottleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<WsThrottleOptions>(
      WS_THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) {
      return true;
    }

    const client = context.switchToWs().getClient<Socket>();
    const eventName = String(context.switchToWs().getPattern());
    const now = Date.now();

    const data = client.data as Record<string, ThrottleState>;
    let state = data[COUNTER_KEY];
    if (!state) {
      state = {};
      data[COUNTER_KEY] = state;
    }

    const entry = state[eventName];
    if (!entry || entry.resetAt <= now) {
      state[eventName] = { count: 1, resetAt: now + options.windowMs };
      return true;
    }

    entry.count += 1;
    if (entry.count > options.limit) {
      throw new WsException(`Socket event "${eventName}" rate limit exceeded`);
    }
    return true;
  }
}
