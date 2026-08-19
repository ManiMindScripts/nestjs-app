import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class SetUserRolesDto {
  @ApiProperty({
    type: [String],
    example: ['6f2a5b7c-8d1e-4f3a-9b2c-1d2e3f4a5b6c'],
    description:
      'Replaces the user role set entirely. At least one role required.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  roleIds: string[];
}
