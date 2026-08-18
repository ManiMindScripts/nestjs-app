import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Token from the password reset link',
    example: 'a1b2c3...',
  })
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  token: string;

  @ApiProperty({
    description: 'New password',
    example: 'NewPassword123',
    minLength: 8,
    maxLength: 100,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  newPassword: string;
}
