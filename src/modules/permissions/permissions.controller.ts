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
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { PermissionsService } from './permissions.service';
import { SafePermission, serializePermission } from './permissions.serializer';

@ApiTags('permissions')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@ApiForbiddenResponse({ description: 'Requires manage:Permission' })
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.PERMISSION,
  })
  @ApiOperation({ summary: 'List all permissions (admin)' })
  @ApiOkResponse({ description: 'All permissions' })
  async findAll(): Promise<SafePermission[]> {
    const permissions = await this.permissionsService.findAllPermissions();
    return permissions.map(serializePermission);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.PERMISSION,
  })
  @ApiOperation({ summary: 'Create a permission (admin)' })
  @ApiCreatedResponse({ description: 'Permission created' })
  @ApiConflictResponse({ description: 'Permission already exists' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  async create(@Body() dto: CreatePermissionDto): Promise<SafePermission> {
    return serializePermission(
      await this.permissionsService.createPermission(dto),
    );
  }

  @Patch(':id')
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.PERMISSION,
  })
  @ApiOperation({
    summary:
      'Update a permission description (admin). action/subject are immutable.',
  })
  @ApiOkResponse({ description: 'Permission updated' })
  @ApiNotFoundResponse({ description: 'Permission not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePermissionDto,
  ): Promise<SafePermission> {
    return serializePermission(
      await this.permissionsService.updatePermission(
        id,
        dto.description ?? null,
      ),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({
    action: PermissionAction.MANAGE,
    subject: PermissionSubject.PERMISSION,
  })
  @ApiOperation({ summary: 'Delete a permission (admin)' })
  @ApiNoContentResponse({ description: 'Permission deleted' })
  @ApiNotFoundResponse({ description: 'Permission not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.permissionsService.removePermission(id);
  }
}
