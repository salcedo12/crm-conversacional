/**
 * Traduce errores de envío de WhatsApp (ycloud / Meta / Twilio) a un mensaje
 * claro en español para mostrar al asesor en el CRM.
 */
export function describeSendError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m   = raw.toLowerCase();

  // Saldo insuficiente en el wallet de ycloud
  if (m.includes('balance') || m.includes('insufficient') || m.includes('saldo') || m.includes('fund')) {
    return 'Sin saldo suficiente en YCloud. Recarga tu wallet en el panel de YCloud para poder enviar.';
  }

  // Fuera de la ventana de 24h sin plantilla
  if ((m.includes('24') && m.includes('window')) || m.includes('re-engagement') || m.includes('reengagement')) {
    return 'La ventana de 24h está cerrada. Para escribir primero debes usar una plantilla aprobada.';
  }

  // Plantilla no aprobada / inexistente
  if (m.includes('template') && (m.includes('not') || m.includes('approve') || m.includes('exist'))) {
    return 'La plantilla no está aprobada o no existe en WhatsApp todavía. Sincroniza o espera la aprobación de Meta.';
  }

  // Número inválido / no registrado
  if (m.includes('not a valid whatsapp') || m.includes('invalid phone') || m.includes('not a whatsapp user')) {
    return 'El número no es un usuario de WhatsApp válido.';
  }

  // Fallback: incluir el mensaje original para no esconder la causa
  return `No se pudo enviar por WhatsApp: ${raw}`;
}
