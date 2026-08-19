import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PERMISSION_SUBJECT_VALUES } from '../../../common/constants/permission-subjects';
import type { PermissionSubjectValue } from '../../../common/constants/permission-subjects';
import { PermissionAction } from '../../../common/constants/permissions.enum';

export class CreatePermissionDto {
  @ApiProperty({ enum: PermissionAction, example: PermissionAction.READ })
  @IsEnum(PermissionAction)
  action: PermissionAction;

  @ApiProperty({ enum: PERMISSION_SUBJECT_VALUES, example: 'User' })
  @IsIn(PERMISSION_SUBJECT_VALUES)
  subject: PermissionSubjectValue;

  @ApiPropertyOptional({ example: 'Read any user', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;
}
