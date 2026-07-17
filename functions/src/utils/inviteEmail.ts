import nodemailer from 'nodemailer';
import { env } from '../config/env';

interface InviteEmailInput {
  to: string;
  displayName: string;
  role: string;
  inviteLink: string;
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Administrador',
    manager: 'Manager',
    advisor: 'Asesor',
    viewer: 'Solo lectura',
  };
  return labels[role] ?? role;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function invitationHtml(input: InviteEmailInput): string {
  const name = escapeHtml(input.displayName);
  const email = escapeHtml(input.to);
  const role = escapeHtml(roleLabel(input.role));
  const inviteLink = escapeHtml(input.inviteLink);
  const loginLink = escapeHtml(env.appBaseUrl() || 'https://crm-conversacional.firebaseapp.com');

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Invitacion a Meraki CRM</title>
  </head>
  <body style="margin:0;background:#0b0b0f;font-family:Arial,Helvetica,sans-serif;color:#f4f4f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0f;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#18181b;border:1px solid #2f2f35;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 18px;border-bottom:1px solid #2f2f35;">
                <div style="display:inline-block;background:#7c3aed;color:#fff;border-radius:12px;padding:8px 11px;font-weight:700;font-size:16px;">M</div>
                <span style="display:inline-block;margin-left:10px;font-size:18px;font-weight:700;vertical-align:middle;">Meraki CRM</span>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 32px;">
                <p style="margin:0 0 10px;color:#a1a1aa;font-size:14px;">Hola ${name},</p>
                <h1 style="margin:0 0 14px;color:#ffffff;font-size:26px;line-height:1.2;">Tu acceso a Meraki CRM esta listo</h1>
                <p style="margin:0 0 18px;color:#d4d4d8;font-size:15px;line-height:1.6;">
                  Esta es tu invitacion para ingresar al CRM. Primero crea tu contrasena y luego entra con el correo asignado.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border:1px solid #2f2f35;border-radius:12px;background:#111113;">
                  <tr>
                    <td style="padding:14px 16px;border-bottom:1px solid #2f2f35;color:#a1a1aa;font-size:12px;">Usuario</td>
                    <td style="padding:14px 16px;border-bottom:1px solid #2f2f35;color:#ffffff;font-size:14px;text-align:right;">${email}</td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;color:#a1a1aa;font-size:12px;">Rol</td>
                    <td style="padding:14px 16px;color:#ffffff;font-size:14px;text-align:right;">${role}</td>
                  </tr>
                </table>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 14px;">
                  <tr>
                    <td style="background:#7c3aed;border-radius:10px;">
                      <a href="${inviteLink}" target="_blank" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;">
                        Crear mi contrasena
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;color:#d4d4d8;font-size:14px;line-height:1.5;">
                  Despues de crearla, ingresa al CRM desde aqui:
                </p>
                <p style="margin:0 0 22px;word-break:break-all;color:#c4b5fd;font-size:13px;line-height:1.5;">
                  <a href="${loginLink}" target="_blank" style="color:#c4b5fd;">${loginLink}</a>
                </p>
                <p style="margin:0 0 10px;color:#a1a1aa;font-size:13px;line-height:1.5;">
                  Si el boton de contrasena no abre, copia y pega este enlace en tu navegador:
                </p>
                <p style="margin:0;word-break:break-all;color:#c4b5fd;font-size:12px;line-height:1.5;">${inviteLink}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px;background:#111113;color:#71717a;font-size:12px;line-height:1.5;">
                Este correo fue enviado automaticamente por Meraki CRM. Si no esperabas esta invitacion, puedes ignorarlo.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendUserInviteEmail(input: InviteEmailInput): Promise<void> {
  if (!env.mailConfigured()) {
    throw new Error('SMTP no configurado.');
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost(),
    port: env.smtpPort(),
    secure: env.smtpSecure(),
    auth: {
      user: env.smtpUser(),
      pass: env.smtpPass(),
    },
  });

  await transporter.sendMail({
    from: env.mailFrom(),
    to: input.to,
    subject: 'Te invitaron a Meraki CRM',
    html: invitationHtml(input),
    text: [
      `Hola ${input.displayName},`,
      '',
      'Te invitaron a Meraki CRM.',
      `Usuario: ${input.to}`,
      `Rol: ${roleLabel(input.role)}`,
      '',
      'Crea tu contrasena para entrar:',
      input.inviteLink,
      '',
      'Despues ingresa al CRM desde:',
      env.appBaseUrl() || 'https://crm-conversacional.firebaseapp.com',
    ].join('\n'),
  });
}
