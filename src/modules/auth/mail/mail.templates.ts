import { parseDurationToMs } from '../../../common/utils/duration';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

interface PasswordResetEmailInput {
  frontendUrl: string;
  resetToken: string;
  /** Raw duration from PASSWORD_RESET_TOKEN_TTL, e.g. "30m". */
  resetTokenTtl: string;
}

/**
 * Deliberately does NOT echo the recipient's address in the body: generic
 * greetings avoid reflecting user input into HTML and give attackers no
 * confirmation about which addresses exist.
 */
export function buildPasswordResetEmail(
  input: PasswordResetEmailInput,
): EmailContent {
  const resetUrl = `${input.frontendUrl}/reset-password?token=${encodeURIComponent(
    input.resetToken,
  )}`;
  const ttlMinutes = Math.max(
    1,
    Math.round(parseDurationToMs(input.resetTokenTtl) / 60_000),
  );

  const text = [
    'Hello,',
    '',
    'We received a request to reset your password.',
    `Open the link below within ${ttlMinutes} minutes to choose a new one:`,
    '',
    resetUrl,
    '',
    'If you did not request a reset, you can safely ignore this email -',
    'your current password keeps working.',
    '',
    '- The My app team',
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2933;line-height:1.5">',
    '<p>Hello,</p>',
    '<p>We received a request to reset your password.</p>',
    `<p><a href="${resetUrl}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px">Reset your password</a></p>`,
    `<p>Or paste this link into your browser (valid for ${ttlMinutes} minutes):<br>${resetUrl}</p>`,
    '<p style="color:#7b8794">If you did not request a reset, you can safely ignore this email - your current password keeps working.</p>',
    '<p>- The My app team</p>',
    '</body></html>',
  ].join('\n');

  return {
    subject: 'My app password reset',
    html,
    text,
  };
}
