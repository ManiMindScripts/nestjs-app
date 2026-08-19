import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { UserProfileDto } from '../../../common/dto/user-profile.dto';

export class CreateUserDto extends UserProfileDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'Roles to assign. When empty or omitted, the default "user" role is used.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  roleIds?: string[];
}
