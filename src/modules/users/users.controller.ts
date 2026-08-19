import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PermissionAction } from '../../common/constants/permissions.enum';
import { PermissionSubject } from '../../common/constants/permission-subjects';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { User } from './entities/user.entity';
import { serializeUser } from './users.serializer';
import type { SafeUser } from './users.serializer';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  getMe(@CurrentUser() user: User): SafeUser {
    return serializeUser(user);
  }

  @Put(':id/roles')
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.USER,
  })
  @ApiOperation({
    summary: 'Replace a user role set (admin). Unknown role ids are rejected.',
  })
  @ApiOkResponse({ description: 'User roles replaced' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiBadRequestResponse({ description: 'Unknown role id(s)' })
  @ApiForbiddenResponse({ description: 'Requires manage:User' })
  async setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
  ): Promise<SafeUser> {
    return serializeUser(await this.usersService.setRoles(id, dto.roleIds));
  }
}
