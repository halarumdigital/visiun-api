import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

class EmailService {
  private async getSmtpConfig(): Promise<Record<string, string>> {
    const configs = await prisma.smtpConfig.findMany();
    const map: Record<string, string> = {};
    for (const c of configs) {
      map[c.key] = c.value;
    }
    return map;
  }

  private async createTransporter(): Promise<Transporter> {
    const config = await this.getSmtpConfig();

    const host = config.smtp_host;
    const port = parseInt(config.smtp_port || '587', 10);
    const user = config.smtp_user;
    const pass = config.smtp_password;
    const secure = config.smtp_secure === 'ssl';

    if (!host || !user || !pass) {
      throw new Error('Configurações SMTP incompletas. Configure em Configurações > SMTP.');
    }

    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  async sendPasswordResetEmail(email: string, name: string, resetToken: string): Promise<void> {
    const config = await this.getSmtpConfig();
    const transporter = await this.createTransporter();

    const fromEmail = config.smtp_from_email || config.smtp_user;
    const fromName = config.smtp_from_name || 'Visiun';
    const resetLink = `${env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#2D3E95;padding:32px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:24px;">Visiun</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 32px;">
              <h2 style="color:#333333;margin:0 0 16px;font-size:20px;">Redefinição de Senha</h2>
              <p style="color:#555555;font-size:16px;line-height:1.6;margin:0 0 16px;">
                Olá${name ? ` <strong>${name}</strong>` : ''},
              </p>
              <p style="color:#555555;font-size:16px;line-height:1.6;margin:0 0 24px;">
                Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${resetLink}" style="display:inline-block;background-color:#2D3E95;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:16px;font-weight:bold;">
                      Redefinir Minha Senha
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:#888888;font-size:14px;line-height:1.5;margin:0 0 8px;">
                Este link é válido por <strong>2 horas</strong>. Após esse período, será necessário solicitar uma nova redefinição.
              </p>
              <p style="color:#888888;font-size:14px;line-height:1.5;margin:0 0 8px;">
                Se você não solicitou esta redefinição, ignore este e-mail. Sua senha permanecerá inalterada.
              </p>
              <hr style="border:none;border-top:1px solid #eeeeee;margin:24px 0;" />
              <p style="color:#aaaaaa;font-size:12px;line-height:1.5;margin:0;">
                Se o botão não funcionar, copie e cole o link abaixo no seu navegador:<br/>
                <a href="${resetLink}" style="color:#2D3E95;word-break:break-all;">${resetLink}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f8f9fa;padding:24px 32px;text-align:center;">
              <p style="color:#aaaaaa;font-size:12px;margin:0;">
                &copy; ${new Date().getFullYear()} Visiun. Todos os direitos reservados.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: email,
      subject: 'Redefinição de senha - Visiun',
      html,
    });

    logger.info({ email }, 'Password reset email sent successfully');
  }
}

export const emailService = new EmailService();
