const fs = require('fs');

// 1. Update LeadRow.tsx
const leadRowPath = 'c:/crm-conversacional/frontend-v2/mobile-app/src/components/LeadRow.tsx';
let leadRowContent = fs.readFileSync(leadRowPath, 'utf8');

const oldToMillis = `function toMillisSafe(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts === 'object' && ('_seconds' in ts || 'seconds' in ts)) {
    return (ts._seconds ?? ts.seconds) * 1000;
  }
  return 0;
}`;

const newToMillis = `function toMillisSafe(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'object' && ('_seconds' in ts || 'seconds' in ts)) {
    return (ts._seconds ?? ts.seconds) * 1000;
  }
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime();
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}`;

leadRowContent = leadRowContent.replace(/\r\n/g, '\n');
if (leadRowContent.includes(oldToMillis.replace(/\r\n/g, '\n'))) {
  leadRowContent = leadRowContent.replace(oldToMillis.replace(/\r\n/g, '\n'), newToMillis);
  fs.writeFileSync(leadRowPath, leadRowContent, 'utf8');
  console.log('LeadRow.tsx updated successfully.');
} else {
  console.log('LeadRow.tsx pattern not matched.');
}

// 2. Update ChatScreen.tsx
const chatScreenPath = 'c:/crm-conversacional/frontend-v2/mobile-app/src/screens/ChatScreen.tsx';
let chatScreenContent = fs.readFileSync(chatScreenPath, 'utf8');
chatScreenContent = chatScreenContent.replace(/\r\n/g, '\n');

const targetChatPattern = `function getManualTakeoverSlaInfo(lead: Lead): ManualTakeoverSlaInfo | null {
  if (lead.aiEnabled) return null;

  const rawLead = lead as unknown as Record<string, unknown>;
  const disabledMillis =
    toMillisSafe(rawLead.aiDisabledAt) ||
    toMillisSafe(lead.aiPausedAt) ||
    0;

  const lastFollowUpMillis =
    toMillisSafe(lead.lastFollowUpAt) ||
    toMillisSafe(lead.lastFichaAt) ||
    0;

  // Requisito estricto: Debe existir seguimiento/ficha técnica previa registrada.
  const hasFollowUp = lastFollowUpMillis > 0;
  const isAfterDisabled = disabledMillis > 0 ? lastFollowUpMillis >= disabledMillis : hasFollowUp;

  if (hasFollowUp && isAfterDisabled) {
    return {
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '✅ Toma manual: Ficha / Seguimiento al día',
    };
  }

  const baseTime =
    disabledMillis > 0
      ? disabledMillis
      : (
          toMillisSafe(lead.lastAdvisorMessageAt) ||
          toMillisSafe(lead.lastMessageAt) ||
          toMillisSafe(lead.updatedAt) ||
          Date.now()
        );

  const deadlineMillis = baseTime + 24 * 3600_000;
  const diffMs = deadlineMillis - Date.now();

  if (diffMs <= 0 || rawLead.aiTakeoverSlaStatus === 'overdue') {`;

const replacementChat = `function getManualTakeoverSlaInfo(lead: Lead): ManualTakeoverSlaInfo | null {
  if (lead.aiEnabled) return null;

  const rawLead = lead as unknown as Record<string, unknown>;

  // Si fue marcado explícitamente como compliant o exento en base de datos
  if (lead.aiTakeoverSlaStatus === 'compliant' || (rawLead.aiTakeoverSlaStatus === 'exempt')) {
    return {
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '✅ Toma manual: Ficha / Seguimiento al día',
    };
  }

  const disabledMillis =
    toMillisSafe(rawLead.aiDisabledAt) ||
    toMillisSafe(lead.aiPausedAt) ||
    0;

  const lastFollowUpMillis =
    toMillisSafe(lead.lastFollowUpAt) ||
    toMillisSafe(lead.lastFichaAt) ||
    0;

  // Requisito estricto: Debe existir seguimiento/ficha técnica previa registrada.
  const hasFollowUp = lastFollowUpMillis > 0;
  const isAfterDisabled = disabledMillis > 0 ? lastFollowUpMillis >= disabledMillis : hasFollowUp;

  if (hasFollowUp && isAfterDisabled) {
    return {
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '✅ Toma manual: Ficha / Seguimiento al día',
    };
  }

  // Exención de históricos anteriores a hoy:
  const startOfTodayMs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0).getTime();
  if (disabledMillis === 0 || disabledMillis < startOfTodayMs) {
    return {
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '● Modo manual',
    };
  }

  const baseTime = disabledMillis;
  const deadlineMillis = baseTime + 24 * 3600_000;
  const diffMs = deadlineMillis - Date.now();

  if (diffMs <= 0 || rawLead.aiTakeoverSlaStatus === 'overdue') {`;

if (chatScreenContent.includes(targetChatPattern)) {
  chatScreenContent = chatScreenContent.replace(targetChatPattern, replacementChat);
  fs.writeFileSync(chatScreenPath, chatScreenContent, 'utf8');
  console.log('ChatScreen.tsx updated successfully.');
} else {
  console.log('ChatScreen.tsx pattern not matched.');
}
