import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class SetRolePermissionsDto {
  @ApiProperty({
    type: [String],
    example: ['6f2a5b7c-8d1e-4f3a-9b2c-1d2e3f4a5b6c'],
    description: 'Replaces the role permission set entirely.',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  permissionIds: string[];
}
