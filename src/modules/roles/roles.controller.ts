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
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';
import { SafeRole, serializeRole } from './roles.serializer';

@ApiTags('roles')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Requires manage:Role' })
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.ROLE,
  })
  @ApiOperation({ summary: 'List all roles with their permissions (admin)' })
  @ApiOkResponse({ description: 'All roles' })
  async findAll(): Promise<SafeRole[]> {
    const roles = await this.rolesService.findAll();
    return roles.map(serializeRole);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.ROLE,
  })
  @ApiOperation({ summary: 'Create a new role (admin)' })
  @ApiOkResponse({ description: 'Role created' })
  @ApiConflictResponse({ description: 'Role name already exists' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  async create(@Body() dto: CreateRoleDto): Promise<SafeRole> {
    return serializeRole(await this.rolesService.create(dto));
  }

  @Patch(':id')
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.ROLE,
  })
  @ApiOperation({ summary: 'Update a role name or description (admin)' })
  @ApiOkResponse({ description: 'Role updated' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  @ApiConflictResponse({ description: 'Role name already exists' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<SafeRole> {
    return serializeRole(await this.rolesService.update(id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.ROLE,
  })
  @ApiOperation({ summary: 'Delete a role (admin)' })
  @ApiNoContentResponse({ description: 'Role deleted' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.rolesService.remove(id);
  }

  @Put(':id/permissions')
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.ROLE,
  })
  @ApiOperation({
    summary:
      'Replace a role permission set (admin). Unknown permission ids are rejected before any change is applied.',
  })
  @ApiOkResponse({ description: 'Role permissions replaced' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  @ApiBadRequestResponse({ description: 'Unknown permission id(s)' })
  async setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
  ): Promise<SafeRole> {
    return serializeRole(
      await this.rolesService.setPermissions(id, dto.permissionIds),
    );
  }
}
