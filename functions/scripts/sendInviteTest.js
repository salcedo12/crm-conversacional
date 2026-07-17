const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

function loadEnv(filePath) {
  const env = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return env;
}

async function main() {
  const to = process.argv[2];
  if (!to) throw new Error('Uso: node scripts/sendInviteTest.js correo@dominio.com');

  const env = loadEnv(path.join(__dirname, '..', '.env'));
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) throw new Error(`Faltan variables SMTP: ${missing.join(', ')}`);

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#0b0b0f;font-family:Arial,Helvetica,sans-serif;color:#f4f4f5;padding:32px">
    <div style="max-width:560px;margin:auto;background:#18181b;border:1px solid #2f2f35;border-radius:16px;overflow:hidden">
      <div style="padding:28px 32px 18px;border-bottom:1px solid #2f2f35">
        <span style="display:inline-block;background:#7c3aed;color:#fff;border-radius:12px;padding:8px 11px;font-weight:700">M</span>
        <span style="display:inline-block;margin-left:10px;font-size:18px;font-weight:700;vertical-align:middle">Meraki CRM</span>
      </div>
      <div style="padding:30px 32px">
        <p style="margin:0 0 10px;color:#a1a1aa;font-size:14px">Hola Admin Principal,</p>
        <h1 style="margin:0 0 14px;color:#fff;font-size:26px">Tu acceso a Meraki CRM esta listo</h1>
        <p style="margin:0 0 18px;color:#d4d4d8;font-size:15px;line-height:1.6">
          Esta es tu invitacion para ingresar al CRM. Primero crea tu contrasena y luego entra con el correo asignado.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border:1px solid #2f2f35;border-radius:12px;background:#111113">
          <tr>
            <td style="padding:14px 16px;border-bottom:1px solid #2f2f35;color:#a1a1aa;font-size:12px">Usuario</td>
            <td style="padding:14px 16px;border-bottom:1px solid #2f2f35;color:#fff;font-size:14px;text-align:right">${to}</td>
          </tr>
          <tr>
            <td style="padding:14px 16px;color:#a1a1aa;font-size:12px">Rol</td>
            <td style="padding:14px 16px;color:#fff;font-size:14px;text-align:right">Administrador</td>
          </tr>
        </table>
        <a href="https://crm-conversacional.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=INVITACION-DE-PRUEBA" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:14px 22px;border-radius:10px">
          Crear mi contrasena
        </a>
        <p style="margin:22px 0 8px;color:#d4d4d8;font-size:14px">Despues de crearla, ingresa al CRM desde aqui:</p>
        <p style="margin:0;word-break:break-all;color:#c4b5fd;font-size:13px">
          <a href="https://crm-conversacional.firebaseapp.com/" style="color:#c4b5fd">https://crm-conversacional.firebaseapp.com/</a>
        </p>
        <p style="margin:24px 0 0;color:#a1a1aa;font-size:12px">Correo de prueba enviado desde Hostinger SMTP.</p>
      </div>
    </div>
  </body>
</html>`;

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    secure: env.SMTP_SECURE !== 'false',
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: env.MAIL_FROM,
    to,
    subject: 'Tu acceso a Meraki CRM',
    html,
    text: `Tu acceso a Meraki CRM esta listo.\n\nUsuario: ${to}\nRol: Administrador\n\nCrea tu contrasena y luego ingresa al CRM desde https://crm-conversacional.firebaseapp.com/`,
  });

  console.log(`ENVIADO ${info.messageId}`);
}

main().catch((err) => {
  console.error(`ERROR ${err.message}`);
  process.exit(1);
});
