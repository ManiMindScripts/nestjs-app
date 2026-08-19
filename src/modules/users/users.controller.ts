import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
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
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { serializeUser } from './users.serializer';
import type { PaginatedUsers, SafeUser } from './users.serializer';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  getMe(@CurrentUser() user: User): SafeUser {
    return serializeUser(user);
  }

  @Get()
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.USER,
  })
  @ApiOperation({ summary: 'List users with their roles (admin), paginated' })
  @ApiOkResponse({ description: 'Paginated users' })
  @ApiForbiddenResponse({ description: 'Requires manage:User' })
  async findAll(@Query() query: ListUsersQueryDto): Promise<PaginatedUsers> {
    const result = await this.usersService.findAll(query);
    return { ...result, items: result.items.map(serializeUser) };
  }

  @Get(':id')
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.USER,
  })
  @ApiOperation({ summary: 'Get a user with their roles (admin)' })
  @ApiOkResponse({ description: 'The user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiForbiddenResponse({ description: 'Requires manage:User' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<SafeUser> {
    return serializeUser(await this.usersService.findWithRolesOrFail(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.USER,
  })
  @ApiOperation({
    summary:
      'Create a user (admin). Assigns the given roles or the default "user" role.',
  })
  @ApiCreatedResponse({ description: 'User created' })
  @ApiConflictResponse({ description: 'Email already registered' })
  @ApiBadRequestResponse({
    description: 'Validation failed or unknown role id(s)',
  })
  @ApiForbiddenResponse({ description: 'Requires manage:User' })
  async create(@Body() dto: CreateUserDto): Promise<SafeUser> {
    return serializeUser(await this.usersService.create(dto));
  }

  @Patch(':id')
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.USER,
  })
  @ApiOperation({
    summary:
      'Update a user name or status (admin). You cannot change your own status.',
  })
  @ApiOkResponse({ description: 'User updated' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiBadRequestResponse({
    description: 'Validation failed or own status change',
  })
  @ApiForbiddenResponse({ description: 'Requires manage:User' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser('id') actingUserId?: string,
  ): Promise<SafeUser> {
    return serializeUser(await this.usersService.update(id, dto, actingUserId));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.USER,
  })
  @ApiOperation({
    summary:
      'Soft-delete a user (admin). Revokes their sessions; the email can be reused.',
  })
  @ApiNoContentResponse({ description: 'User deleted' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiBadRequestResponse({ description: 'Cannot delete your own account' })
  @ApiForbiddenResponse({ description: 'Requires manage:User' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') actingUserId?: string,
  ): Promise<void> {
    await this.usersService.softDelete(id, actingUserId);
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
