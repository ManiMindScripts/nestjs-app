import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { JwtConfig } from '../../config/jwt.config';
import { SafeUser } from '../users/users.serializer';
import { AuthService, AuthSession, SessionMetadata } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

interface AuthResponse {
  accessToken: string;
  user: SafeUser;
}

const AUTH_ENDPOINT_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle(AUTH_ENDPOINT_THROTTLE)
  @ApiOperation({ summary: 'Register a new account (auto-logs in)' })
  @ApiCreatedResponse({ description: 'Account created, session established' })
  @ApiBadRequestResponse({ description: 'Validation failed or email taken' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.authService.register(
      dto,
      this.getSessionMeta(request),
    );
    this.setRefreshCookie(response, session.refreshToken);
    return this.toAuthResponse(session);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ENDPOINT_THROTTLE)
  @ApiOperation({ summary: 'Log in and establish a session' })
  @ApiOkResponse({ description: 'Authenticated' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.authService.login(
      dto,
      this.getSessionMeta(request),
    );
    this.setRefreshCookie(response, session.refreshToken);
    return this.toAuthResponse(session);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ENDPOINT_THROTTLE)
  @ApiCookieAuth()
  @ApiOperation({
    summary:
      'Rotate the refresh token (cookie). Reusing an already-rotated token revokes the whole session family.',
  })
  @ApiOkResponse({ description: 'New access token issued' })
  @ApiUnauthorizedResponse({ description: 'Invalid or revoked refresh token' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const session = await this.authService.refresh(
      this.getRefreshCookie(request),
      this.getSessionMeta(request),
    );
    this.setRefreshCookie(response, session.refreshToken);
    return this.toAuthResponse(session);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary:
      'Revoke the current refresh token (cookie) and clear it. Other devices in the same session family stay logged in.',
  })
  @ApiNoContentResponse({ description: 'Logged out' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(this.getRefreshCookie(request));
    this.clearRefreshCookie(response);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_ENDPOINT_THROTTLE)
  @ApiOperation({
    summary:
      'Request a password reset link. Always returns 200 to avoid account enumeration.',
  })
  @ApiOkResponse({ description: 'Reset link sent if the email exists' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.authService.forgotPassword(dto, this.getSessionMeta(request));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Set a new password with a reset token. Revokes all active sessions for the user.',
  })
  @ApiNoContentResponse({ description: 'Password updated' })
  @ApiBadRequestResponse({ description: 'Invalid or expired reset token' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto);
  }

  private getSessionMeta(request: Request): SessionMetadata {
    return {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  private getRefreshCookie(request: Request): string | undefined {
    const cookieName =
      this.configService.getOrThrow<JwtConfig>('jwt').cookieName;
    return request.cookies?.[cookieName] as string | undefined;
  }

  private setRefreshCookie(response: Response, token: string): void {
    const jwtConfig = this.configService.getOrThrow<JwtConfig>('jwt');

    response.cookie(jwtConfig.cookieName, token, {
      httpOnly: true,
      secure: jwtConfig.cookieSecure,
      sameSite: jwtConfig.cookieSameSite,
      path: jwtConfig.cookiePath,
      maxAge: jwtConfig.refreshExpiresInMs,
    });
  }

  private clearRefreshCookie(response: Response): void {
    const jwtConfig = this.configService.getOrThrow<JwtConfig>('jwt');

    response.clearCookie(jwtConfig.cookieName, {
      httpOnly: true,
      secure: jwtConfig.cookieSecure,
      sameSite: jwtConfig.cookieSameSite,
      path: jwtConfig.cookiePath,
    });
  }

  private toAuthResponse(session: AuthSession): AuthResponse {
    return {
      accessToken: session.accessToken,
      user: session.user,
    };
  }
}
