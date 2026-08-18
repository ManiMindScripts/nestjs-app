import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/app.config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly configService: ConfigService) {}

  sendPasswordReset(email: string, resetToken: string): Promise<void> {
    const { nodeEnv, frontendUrl } =
      this.configService.getOrThrow<AppConfig>('app');

    if (nodeEnv === 'production') {
      // TODO(phase 8): dispatch through an SMTP/transactional provider.
      // The reset flow is designed so only this method needs to change.
      this.logger.error(
        `Password reset requested for ${email} but no email provider is configured`,
      );
      return Promise.resolve();
    }

    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
    this.logger.warn(
      `[DEV MAIL] Password reset link for ${email}: ${resetUrl}`,
    );
    return Promise.resolve();
  }
}
