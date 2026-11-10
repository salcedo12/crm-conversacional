const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../functions/src/http/ycloudWebhook.function.ts');
let c = fs.readFileSync(file, 'utf8');

const t1 = `  // Sin ninguna identidad utilizable no hay forma de crear el lead.
  if (!hasPhone && !userId) {
    logger.warn('[ycloud] Mensaje sin teléfono ni BSUID — no se puede identificar el lead', { msgId });
    return;
  }`.replace(/\r?\n/g, '\r\n');

const r1 = `  // Sin ninguna identidad utilizable no hay forma de crear el lead.
  if (!hasPhone && !userId) {
    logger.warn('[ycloud] Mensaje sin teléfono ni BSUID — no se puede identificar el lead', { msgId });
    return;
  }

  // Si el remitente es un asesor o una línea interna de la empresa, NO se debe
  // registrar como prospecto ni repartir a un asesor de ventas.
  if (hasPhone && (await isCompanyTeamPhone(companyId, normPhone || phone))) {
    logger.info('[ycloud] Mensaje de miembro interno o línea corporativa omitido (no es lead)', {
      companyId,
      phone: normPhone || phone,
      msgId,
    });
    return;
  }`.replace(/\r?\n/g, '\r\n');

if (!c.includes(t1)) {
  console.error('Target 1 not found in ycloudWebhook');
  process.exit(1);
}
c = c.replace(t1, r1);

const t2 = `    const customerPhone = payload.from.startsWith('+') ? payload.from : \`+\${payload.from}\`;
    const normPhone = toNormalizedPhone(customerPhone);
    const inboxId = normalizeBusinessNumber(payload.to);`.replace(/\r?\n/g, '\r\n');

const r2 = `    const customerPhone = payload.from.startsWith('+') ? payload.from : \`+\${payload.from}\`;
    const normPhone = toNormalizedPhone(customerPhone);
    const inboxId = normalizeBusinessNumber(payload.to);

    if (await isCompanyTeamPhone(companyId, normPhone || customerPhone)) {
      logger.info('[ycloud Calling] Llamada de miembro interno del equipo omitida (no es lead)', {
        companyId,
        phone: customerPhone,
      });
      return;
    }`.replace(/\r?\n/g, '\r\n');

if (!c.includes(t2)) {
  console.error('Target 2 not found in ycloudWebhook');
  process.exit(1);
}
c = c.replace(t2, r2);

fs.writeFileSync(file, c, 'utf8');
console.log('Successfully patched functions/src/http/ycloudWebhook.function.ts');
