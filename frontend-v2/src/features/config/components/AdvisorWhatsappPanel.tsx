import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarX,
  CheckCircle2,
  Clock3,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { formatPhone } from '@/shared/utils/formatPhone';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import { listCompanyUsers, type CompanyUser } from '@/features/leads/services/advisors.service';
import { listMessagingLines, type MessagingLine } from '@/features/templates/services/templates.service';
import {
  disconnectAdvisorWhatsapp,
  listAdvisorWhatsappConnections,
  requestAdvisorWhatsappQr,
  type AdvisorWhatsappConnection,
  type AdvisorWhatsappQrResult,
  type AdvisorWhatsappStatus,
} from '../services/advisorWhatsapp.service';

interface AdvisorWhatsappPanelProps {
  companyId: string;
}

type BusyState =
  | { action: 'load' }
  | { action: 'qr' | 'disconnect'; advisorId: string }
  | null;

interface AdvisorRow {
  id: string;
  displayName: string;
  email?: string;
  role?: string;
  googleConnected?: boolean;
  connection?: AdvisorWhatsappConnection;
}

function statusLabel(status?: AdvisorWhatsappStatus): string {
  if (status === 'connected') return 'Conectado';
  if (status === 'qr_pending') return 'Esperando QR';
  if (status === 'stale') return 'Sesion vencida';
  if (status === 'error') return 'Con error';
  if (status === 'configuration_required') return 'Falta configurar';
  return 'Desconectado';
}

function statusClass(status?: AdvisorWhatsappStatus): string {
  if (status === 'connected') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
  if (status === 'qr_pending') return 'border-amber-500/25 bg-amber-500/10 text-amber-300';
  if (status === 'stale') return 'border-orange-500/25 bg-orange-500/10 text-orange-300';
  if (status === 'error' || status === 'configuration_required') return 'border-red-500/25 bg-red-500/10 text-red-300';
  return 'border-zinc-700 bg-zinc-800 text-zinc-300';
}

function statusIcon(status?: AdvisorWhatsappStatus) {
  if (status === 'connected') return <CheckCircle2 size={14} />;
  if (status === 'qr_pending') return <Clock3 size={14} />;
  if (status === 'stale' || status === 'error' || status === 'configuration_required') return <AlertTriangle size={14} />;
  return <WifiOff size={14} />;
}

function formatDate(value?: number | null): string {
  if (!value) return 'Sin actividad';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function needsAttention(status?: AdvisorWhatsappStatus): boolean {
  return status !== 'connected';
}

function issueText(connection?: AdvisorWhatsappConnection): string {
  if (!connection) return 'Este asesor todavia no tiene WhatsApp vinculado.';
  if (connection.status === 'configuration_required') return 'Falta configurar el puente del servidor.';
  if (connection.status === 'qr_pending') return 'Hay un QR pendiente por escanear.';
  if (connection.status === 'stale') return 'La sesion se vencio o WhatsApp la cerro. Conviene reconectar.';
  if (connection.status === 'error') return connection.error || 'La conexion reporto un error.';
  if (connection.status === 'disconnected') return 'Este WhatsApp esta desconectado.';
  return '';
}

function calendarStatusClass(connected?: boolean): string {
  return connected
    ? 'border-sky-500/25 bg-sky-500/10 text-sky-300'
    : 'border-amber-500/25 bg-amber-500/10 text-amber-300';
}

export function AdvisorWhatsappPanel({ companyId }: AdvisorWhatsappPanelProps) {
  const { profile, role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);
  const selfAdvisorId = profile?.id;

  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [connections, setConnections] = useState<AdvisorWhatsappConnection[]>([]);
  // Asesores con línea de COEXISTENCIA (API oficial). A ellos NO se les ofrece
  // Baileys: usar Baileys en el mismo número los hace banear. uid → número.
  const [coexByAdvisor, setCoexByAdvisor] = useState<Map<string, MessagingLine>>(new Map());
  const [qrByAdvisor, setQrByAdvisor] = useState<Record<string, AdvisorWhatsappQrResult | undefined>>({});
  const [busy, setBusy] = useState<BusyState>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo<AdvisorRow[]>(() => {
    const connectionByAdvisor = new Map(connections.map((connection) => [connection.advisorId, connection]));
    const activeUsers = users.filter((user) => user.active && ['admin', 'manager', 'advisor'].includes(user.role));

    if (isAdmin) {
      return activeUsers.map((user) => ({
        id: user.id,
        displayName: user.displayName || user.email || 'Asesor',
        email: user.email,
        role: user.role,
        googleConnected: user.googleConnected,
        connection: connectionByAdvisor.get(user.id),
      }));
    }

    if (!selfAdvisorId) return [];
    return [{
      id: selfAdvisorId,
      displayName: profile?.displayName || profile?.email || 'Mi WhatsApp',
      email: profile?.email,
      role: role ?? undefined,
      googleConnected: undefined,
      connection: connectionByAdvisor.get(selfAdvisorId),
    }];
  }, [connections, isAdmin, profile?.displayName, profile?.email, role, selfAdvisorId, users]);

  // Los asesores en coexistencia no "necesitan revisar" su Baileys (no lo usan).
  const attentionRows = rows.filter((row) => !coexByAdvisor.has(row.id) && needsAttention(row.connection?.status));
  const connectedCount = rows.filter((row) => row.connection?.status === 'connected').length;
  const calendarConnectedCount = rows.filter((row) => row.googleConnected).length;
  const calendarAttentionRows = isAdmin ? rows.filter((row) => !row.googleConnected) : [];

  const load = async (silent = false) => {
    if (!companyId || (!isAdmin && !selfAdvisorId)) return;
    if (!silent) setBusy({ action: 'load' });
    setError(null);
    try {
      const [nextConnections, nextUsers, lines] = await Promise.all([
        listAdvisorWhatsappConnections(companyId, isAdmin ? undefined : selfAdvisorId),
        isAdmin ? listCompanyUsers(companyId) : Promise.resolve([]),
        listMessagingLines(companyId).catch(() => [] as MessagingLine[]),
      ]);
      setConnections(nextConnections);
      setUsers(nextUsers);
      const coex = new Map<string, MessagingLine>();
      for (const l of lines) if (!l.isDefault && l.advisorId) coex.set(l.advisorId, l);
      setCoexByAdvisor(coex);
    } catch (err) {
      console.error('[AdvisorWhatsappPanel] load error:', err);
      if (!silent) setError('No se pudo cargar el estado de WhatsApp de los asesores.');
    } finally {
      if (!silent) setBusy(null);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, isAdmin, selfAdvisorId]);

  useEffect(() => {
    const timer = window.setInterval(() => load(true), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, isAdmin, selfAdvisorId]);

  const requestQr = async (advisorId: string) => {
    setBusy({ action: 'qr', advisorId });
    setError(null);
    setQrByAdvisor((prev) => ({ ...prev, [advisorId]: undefined }));
    try {
      const result = await requestAdvisorWhatsappQr(companyId, advisorId);
      setQrByAdvisor((prev) => ({ ...prev, [advisorId]: result }));
      await load(true);
    } catch (err) {
      console.error('[AdvisorWhatsappPanel] qr error:', err);
      setError(err instanceof Error ? err.message : 'No se pudo generar el QR.');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (advisorId: string, name: string) => {
    if (!confirm(`Desconectar el WhatsApp de ${name}?`)) return;
    setBusy({ action: 'disconnect', advisorId });
    setError(null);
    try {
      await disconnectAdvisorWhatsapp(companyId, advisorId);
      setQrByAdvisor((prev) => ({ ...prev, [advisorId]: undefined }));
      await load(true);
    } catch (err) {
      console.error('[AdvisorWhatsappPanel] disconnect error:', err);
      setError('No se pudo desconectar WhatsApp.');
    } finally {
      setBusy(null);
    }
  };

  const isLoading = busy?.action === 'load';

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Conexiones de asesores</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
              Revisa WhatsApp para seguimientos manuales y Google Calendar para agendar citas con Meet.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300">
              WhatsApp {connectedCount}/{rows.length || 0}
            </span>
            {isAdmin && (
              <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300">
                Calendar {calendarConnectedCount}/{rows.length || 0}
              </span>
            )}
            <Button size="sm" variant="secondary" onClick={() => load()} loading={isLoading} disabled={busy !== null}>
              <RefreshCw size={14} /> Revisar
            </Button>
          </div>
        </div>

        {attentionRows.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <p>
              {attentionRows.length === 1
                ? `${attentionRows[0].displayName} necesita revisar su conexion de WhatsApp.`
                : `${attentionRows.length} asesores necesitan revisar su conexion de WhatsApp.`}
            </p>
          </div>
        )}

        {calendarAttentionRows.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
            <CalendarX size={15} className="mt-0.5 shrink-0" />
            <p>
              {calendarAttentionRows.length === 1
                ? `${calendarAttentionRows[0].displayName} necesita conectar Google Calendar.`
                : `${calendarAttentionRows.length} asesores necesitan conectar Google Calendar.`}
            </p>
          </div>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => {
            const connection = row.connection;
            const status = connection?.status;
            const qrResult = qrByAdvisor[row.id];
            const cardIssue = issueText(connection);
            const qrBusy = busy?.action === 'qr' && busy.advisorId === row.id;
            const disconnectBusy = busy?.action === 'disconnect' && busy.advisorId === row.id;
            // Asesor en coexistencia (API oficial): su "Mi WhatsApp" es su propia
            // línea por la API. NO se le ofrece Baileys (mismo número + cliente no
            // oficial = baneo). Ver [[getAdvisorLineForAdvisor]].
            const coex = coexByAdvisor.get(row.id);

            return (
              <article key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                <div className="flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-violet-300">
                        <Smartphone size={21} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-100">{row.displayName}</p>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">{row.email || row.role || 'Asesor'}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${coex ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : statusClass(status)}`}>
                        {coex ? <CheckCircle2 size={14} /> : statusIcon(status)}
                        {coex ? 'Coexistencia (API oficial)' : `WhatsApp ${statusLabel(status).toLowerCase()}`}
                      </span>
                      {isAdmin && (
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${calendarStatusClass(row.googleConnected)}`}>
                          {row.googleConnected ? <CalendarCheck size={14} /> : <CalendarX size={14} />}
                          Calendar {row.googleConnected ? 'conectado' : 'sin conectar'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-zinc-500">Numero conectado</span>
                      <span className="truncate text-right font-medium text-zinc-200">
                        {coex ? formatPhone(coex.number) : (connection?.phone ? formatPhone(connection.phone) : 'Sin numero')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-zinc-500">Ultima actividad</span>
                      <span className="truncate text-right text-zinc-300">{formatDate(connection?.lastSeenAt)}</span>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-zinc-500">Google Calendar</span>
                        <span className={`truncate text-right font-medium ${row.googleConnected ? 'text-sky-300' : 'text-amber-300'}`}>
                          {row.googleConnected ? 'Conectado' : 'Sin conectar'}
                        </span>
                      </div>
                    )}
                  </div>

                  {coex ? (
                    <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                      <p>
                        Esta línea usa la <strong>API oficial (coexistencia)</strong>. Envía desde “Mi WhatsApp”
                        por su propio número. <strong>No usa Baileys</strong> — no escanees QR aquí (un cliente no
                        oficial en este número lo hace banear).
                      </p>
                    </div>
                  ) : status === 'connected' ? (
                    <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                      <p>Activo para reflejar seguimientos manuales en el CRM.</p>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <p>{cardIssue}</p>
                    </div>
                  )}

                  {isAdmin && !row.googleConnected && (
                    <div className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
                      <CalendarX size={15} className="mt-0.5 shrink-0" />
                      <p>Debe entrar con su usuario y conectar Google Calendar para crear citas con Meet.</p>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {/* En coexistencia NO se ofrece "Generar QR" (Baileys) para evitar
                        el baneo por cliente no oficial en el mismo número. */}
                    {!coex && (
                      <Button size="sm" onClick={() => requestQr(row.id)} loading={qrBusy} disabled={busy !== null}>
                        <QrCode size={14} /> Generar QR
                      </Button>
                    )}
                    {/* "Desconectar" sigue disponible para limpiar cualquier sesión
                        Baileys residual en un número que ahora es de coexistencia. */}
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => disconnect(row.id, row.displayName)}
                      loading={disconnectBusy}
                      disabled={busy !== null || (!connection && !coex)}
                    >
                      <Unplug size={14} /> {coex ? 'Limpiar Baileys' : 'Desconectar'}
                    </Button>
                  </div>

                  {qrResult?.status === 'configuration_required' && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                      <p>Falta activar el puente de WhatsApp de asesor en el servidor antes de mostrar el QR.</p>
                    </div>
                  )}

                  {qrResult?.qrCodeDataUrl && (
                    <div className="grid gap-3 rounded-lg border border-violet-500/25 bg-violet-500/10 p-3 sm:grid-cols-[148px_1fr]">
                      <img src={qrResult.qrCodeDataUrl} alt="QR de WhatsApp" className="h-36 w-36 rounded-lg bg-white p-2" />
                      <div className="text-xs leading-5 text-violet-100">
                        <p className="font-semibold text-zinc-100">Escanear desde WhatsApp</p>
                        <p className="mt-1 text-violet-200">Abre dispositivos vinculados, escanea este codigo y luego pulsa Revisar.</p>
                      </div>
                    </div>
                  )}

                  {qrResult?.qrCode && !qrResult.qrCodeDataUrl && (
                    <textarea
                      readOnly
                      value={qrResult.qrCode}
                      className="h-20 w-full resize-none rounded-md border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-300 outline-none"
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {rows.length === 0 && !isLoading && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-6 text-center text-sm text-zinc-500">
            No hay asesores activos para mostrar.
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
