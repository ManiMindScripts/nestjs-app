import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { IsNull, Repository, DataSource } from 'typeorm';
import { UserStatus } from '../../common/constants/user-status.enum';
import { hashPassword, verifyPassword } from '../../common/utils/password';
import { JwtConfig } from '../../config/jwt.config';
import { SafeUser, serializeUser } from '../users/users.serializer';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { MailService } from './mail/mail.service';

export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  private get jwtConfig(): JwtConfig {
    return this.configService.getOrThrow<JwtConfig>('jwt');
  }

  async register(
    dto: RegisterDto,
    meta: SessionMetadata,
  ): Promise<AuthSession> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await hashPassword(dto.password);
    const user = await this.usersService.createWithDefaultRole({
      email,
      passwordHash,
      firstName: dto.firstName?.trim() || null,
      lastName: dto.lastName?.trim() || null,
    });

    return this.createSession(user, meta);
  }

  async login(dto: LoginDto, meta: SessionMetadata): Promise<AuthSession> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await verifyPassword(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Account is not active');
    }

    return this.createSession(user, meta);
  }

  async refresh(
    presentedToken: string | undefined,
    meta: SessionMetadata,
  ): Promise<AuthSession> {
    if (!presentedToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const tokenHash = this.hashToken(presentedToken);

    // The transaction commits before any exception is thrown so that the
    // theft/expiry revocation is persisted (throwing inside the transaction
    // would roll it back).
    return this.dataSource
      .transaction(async (manager) => {
        const stored = await manager.findOne(RefreshToken, {
          where: { tokenHash },
          lock: { mode: 'pessimistic_write' },
        });

        if (!stored) {
          return { outcome: 'invalid' as const };
        }

        // Token was already rotated or revoked -> probable theft. Kill the
        // whole session family so any attacker-held sibling tokens die too.
        if (stored.revokedAt || stored.usedAt) {
          await manager.update(
            RefreshToken,
            { familyId: stored.familyId, revokedAt: IsNull() },
            { revokedAt: new Date() },
          );
          return { outcome: 'theft' as const };
        }

        if (stored.expiresAt.getTime() < Date.now()) {
          await manager.update(RefreshToken, stored.id, {
            revokedAt: new Date(),
          });
          return { outcome: 'expired' as const };
        }

        // Loaded separately (not via a relation) because a pessimistic lock
        // cannot be applied to the nullable side of an outer join.
        const user = await manager.findOne(User, {
          where: { id: stored.userId },
        });

        if (!user || user.status !== UserStatus.ACTIVE) {
          return { outcome: 'inactive' as const };
        }

        const nextRefreshToken = this.generateOpaqueToken();
        const nextToken = await manager.save(
          manager.create(RefreshToken, {
            tokenHash: this.hashToken(nextRefreshToken),
            userId: user.id,
            familyId: stored.familyId,
            expiresAt: this.refreshExpiry(),
            ipAddress: meta.ipAddress ?? null,
            userAgent: meta.userAgent ?? null,
          }),
        );

        // Rotate: invalidate the presented token, link it to its replacement.
        await manager.update(RefreshToken, stored.id, {
          usedAt: new Date(),
          revokedAt: new Date(),
          replacedByTokenId: nextToken.id,
        });

        return { outcome: 'ok' as const, user, refreshToken: nextRefreshToken };
      })
      .then((result) => {
        switch (result.outcome) {
          case 'invalid':
            throw new UnauthorizedException('Invalid refresh token');
          case 'theft':
            throw new UnauthorizedException('Invalid refresh token');
          case 'expired':
            throw new UnauthorizedException('Refresh token expired');
          case 'inactive':
            throw new UnauthorizedException('Account is not active');
          case 'ok':
            return this.buildSession(result.user, result.refreshToken);
        }
      });
  }

  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) {
      return;
    }

    // Revoke only the presented token, leaving sibling sessions (other
    // devices in the same family) untouched. Whole-family revocation happens
    // only on theft detection and on password reset.
    const stored = await this.refreshTokenRepository.findOne({
      where: { tokenHash: this.hashToken(presentedToken) },
    });

    if (!stored || stored.revokedAt) {
      return;
    }

    await this.refreshTokenRepository.update(stored.id, {
      revokedAt: new Date(),
    });
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    meta: SessionMetadata,
  ): Promise<void> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.usersService.findByEmail(email);

    // Always succeed: never disclose whether an email is registered.
    if (!user || user.status !== UserStatus.ACTIVE) {
      return;
    }

    const resetToken = this.generateOpaqueToken();

    // Invalidate any previously issued, still-unused reset tokens.
    await this.passwordResetTokenRepository.update(
      { userId: user.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    await this.passwordResetTokenRepository.save(
      this.passwordResetTokenRepository.create({
        userId: user.id,
        tokenHash: this.hashToken(resetToken),
        expiresAt: this.resetExpiry(),
        ipAddress: meta.ipAddress ?? null,
      }),
    );

    await this.mailService.sendPasswordReset(user.email, resetToken);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const record = await this.passwordResetTokenRepository.findOne({
      where: { tokenHash: this.hashToken(dto.token) },
      relations: { user: true },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now() ||
      !record.user ||
      record.user.status !== UserStatus.ACTIVE
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await hashPassword(dto.newPassword);
    await this.usersService.updatePassword(record.user.id, passwordHash);

    await this.passwordResetTokenRepository.update(record.id, {
      usedAt: new Date(),
    });

    // Force re-login everywhere: revoke every active refresh token the user has.
    await this.refreshTokenRepository.update(
      { userId: record.user.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async createSession(
    user: User,
    meta: SessionMetadata,
  ): Promise<AuthSession> {
    const refreshToken = this.generateOpaqueToken();

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        tokenHash: this.hashToken(refreshToken),
        userId: user.id,
        familyId: randomUUID(),
        expiresAt: this.refreshExpiry(),
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      }),
    );

    return this.buildSession(user, refreshToken);
  }

  private async buildSession(
    user: User,
    refreshToken: string,
  ): Promise<AuthSession> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return {
      accessToken,
      refreshToken,
      user: serializeUser(user),
    };
  }

  private generateOpaqueToken(): string {
    return randomBytes(32).toString('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.jwtConfig.refreshExpiresInMs);
  }

  private resetExpiry(): Date {
    return new Date(Date.now() + this.jwtConfig.resetTokenTtlMs);
  }
}
