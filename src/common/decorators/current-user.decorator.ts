import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../modules/users/entities/user.entity';

export const CurrentUser = createParamDecorator(
  (data: keyof User | undefined, ctx: ExecutionContext): User | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: User }>();
    if (data) {
      return request.user?.[data] as User | undefined;
    }
    return request.user;
  },
);
