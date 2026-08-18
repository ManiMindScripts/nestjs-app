import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { serializeUser } from './users.serializer';
import type { SafeUser } from './users.serializer';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  getMe(@CurrentUser() user: User): SafeUser {
    return serializeUser(user);
  }
}
