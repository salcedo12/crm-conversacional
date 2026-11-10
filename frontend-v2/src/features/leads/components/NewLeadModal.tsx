import { useState, useEffect } from 'react';
import { UserPlus, Building2, User, Phone, Mail, FileText, CheckCircle2, Compass, ShieldAlert, RefreshCw, Sparkles, Send } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { CountryPhoneInput } from '@/shared/components/CountryPhoneInput';
import {
  createContact,
  checkPhoneAvailability,
  requestLeadTransfer,
  buildInternationalPhone,
  type PhoneAvailabilityResult,
} from '@/features/inbox/services/contacts.service';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import type { Advisor } from '../services/advisors.service';
import { subscribeLeadSources, type LeadSourceItem } from '@/features/config/services/leadSources.service';

interface NewLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  advisors: Advisor[];
  onCreated: (leadId: string, existed: boolean) => void;
}

export const MERAKI_PROJECTS = [
  { id: 'Cañón de Arizona', label: 'Cañón de Arizona (San Francisco / Las Vegas / Colorado / Texas / LA)' },
  { id: 'Río Claro', label: 'Río Claro (Río Lagunilla / Río Medina)' },
  { id: 'Laguna Mar', label: 'Laguna Mar (Melgar: Mar Canarias / Mar Santorini)' },
  { id: 'Sobre Montañas', label: 'Sobre Montañas de Alvarado (17 Aldeas)' },
  { id: 'Llano Grande', label: 'Llano Grande (Santa Helena / Guatapé / Poblado / San Antonio)' },
  { id: 'Proyectos de Ibagué', label: 'Proyectos de Ibagué' },
];

export function NewLeadModal({
  isOpen,
  onClose,
  companyId,
  advisors,
  onCreated,
}: NewLeadModalProps) {
  const { user, role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);

  const [name, setName] = useState('');
  const [countryIso, setCountryIso] = useState('co');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [project, setProject] = useState(MERAKI_PROJECTS[0].id);
  const [assignedTo, setAssignedTo] = useState(user?.uid || '');
  const [notes, setNotes] = useState('');
  const [sources, setSources] = useState<LeadSourceItem[]>([]);
  const [selectedSource, setSelectedSource] = useState('Trabajo de campo');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado de validación de teléfono en tiempo real
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [phoneCheck, setPhoneCheck] = useState<PhoneAvailabilityResult | null>(null);

  // Estado para Solicitud de Traslado
  const [transferReason, setTransferReason] = useState('');
  const [requestingTransfer, setRequestingTransfer] = useState(false);
  const [transferRequested, setTransferRequested] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    const unsub = subscribeLeadSources(companyId, (items) => {
      const actives = items.filter((s) => s.active);
      setSources(actives);
      if (actives.length > 0) {
        setSelectedSource((prev) => {
          if (actives.some((s) => s.name === prev)) return prev;
          const defaultSrc = actives.find((s) => s.name === 'Trabajo de campo') || actives[0];
          return defaultSrc.name;
        });
      }
    });
    return () => unsub();
  }, [companyId]);

  const { fullPhone, isValidLength } = buildInternationalPhone(countryIso, phone);

  // Validación instantánea de duplicados y exclusividad al escribir el teléfono o cambiar el país
  useEffect(() => {
    if (!isOpen || !companyId) return;
    setTransferRequested(false);
    if (!isValidLength || !fullPhone) {
      setPhoneCheck(null);
      setCheckingPhone(false);
      return;
    }

    let cancelled = false;
    setCheckingPhone(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await checkPhoneAvailability(companyId, fullPhone);
        if (cancelled) return;
        setPhoneCheck(res);
        if (res.hasPendingRequest) {
          setTransferRequested(true);
        }
        // Si ya está en la propia cartera o libre por abandono y tiene nombre, autocompletarlo
        if ((res.status === 'reclaimable' || res.status === 'own') && res.leadName && res.leadName !== 'Sin Nombre') {
          setName((prev) => (prev.trim() ? prev : res.leadName!));
        }
      } catch {
        if (!cancelled) setPhoneCheck(null);
      } finally {
        if (!cancelled) setCheckingPhone(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fullPhone, isValidLength, companyId, isOpen]);

  if (!isOpen) return null;

  const isLockedForAdvisor = !isAdmin && phoneCheck?.status === 'locked_by_other';
  const canSubmit = isValidLength && !saving && !checkingPhone && !isLockedForAdvisor;

  const handleRequestTransfer = async () => {
    if (!companyId || !phoneCheck?.leadId || requestingTransfer) return;
    setRequestingTransfer(true);
    setError(null);
    try {
      await requestLeadTransfer({
        companyId,
        leadId: phoneCheck.leadId,
        phone: fullPhone,
        reason: transferReason.trim() || notes.trim() || 'Solicitud de traslado desde registro de prospecto',
      });
      setTransferRequested(true);
    } catch (err: any) {
      console.error('[NewLeadModal] Error solicitando traslado:', err);
      setError(err?.message || 'No se pudo enviar la solicitud de traslado.');
    } finally {
      setRequestingTransfer(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    try {
      const res = await createContact({
        companyId,
        name: name.trim() || undefined,
        phone: fullPhone,
        email: email.trim() || undefined,
        project,
        tags: ['outbound_propio'],
        assignedTo: isAdmin && assignedTo ? assignedTo : (user?.uid || undefined),
        notes: notes.trim() || undefined,
        fuenteUbicacion: selectedSource || 'Trabajo de campo',
      });

      onCreated(res.leadId, res.existed);
      onClose();
    } catch (err: any) {
      console.error('[NewLeadModal] Error al crear prospecto:', err);
      let msg = err?.message || 'No se pudo crear el prospecto.';
      if (typeof msg === 'string') {
        if (msg.includes('already-exists')) {
          msg = msg.replace(/^.*already-exists[:\s]*/i, '');
        } else if (msg.includes('invalid-argument')) {
          msg = msg.replace(/^.*invalid-argument[:\s]*/i, '');
        } else if (msg === 'INTERNAL' || err?.code === 'functions/internal') {
          msg = 'No se pudo validar el prospecto. Verifica que el teléfono sea válido y no esté duplicado.';
        }
      }
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden text-zinc-100 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
              <UserPlus size={18} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <span>Nuevo Prospecto</span>
                <span className="text-[10px] font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  Outbound Propio
                </span>
              </h3>
              <p className="text-[11px] text-zinc-400">
                Registra captación propia nacional o internacional para tu meta mensual.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 p-1 rounded-lg text-sm"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Teléfono con Buscador Mundial de Países y Correo */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-7">
              <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Phone size={13} className="text-zinc-500" /> Teléfono Celular <span className="text-red-400">*</span>
                </span>
                {checkingPhone ? (
                  <span className="text-[10px] text-amber-300 flex items-center gap-1">
                    <RefreshCw size={10} className="animate-spin" /> Validando...
                  </span>
                ) : fullPhone && isValidLength ? (
                  <span className="text-[10px] font-mono text-emerald-400">{fullPhone}</span>
                ) : null}
              </label>
              <CountryPhoneInput
                countryIso={countryIso}
                onCountryChange={setCountryIso}
                phone={phone}
                onPhoneChange={setPhone}
                statusBorder={
                  phoneCheck?.status === 'available'
                    ? 'available'
                    : phoneCheck?.status === 'reclaimable'
                    ? 'reclaimable'
                    : phoneCheck?.status === 'locked_by_other'
                    ? 'locked_by_other'
                    : 'default'
                }
              />
            </div>
            <div className="sm:col-span-5">
              <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center gap-1.5">
                <Mail size={13} className="text-zinc-500" /> Correo Electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="opcional@correo.com"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/90 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
              />
            </div>
          </div>

          {/* Tarjeta de Resultado de Validación en Tiempo Real */}
          {phoneCheck && phoneCheck.status !== 'invalid' && (
            <div
              className={`rounded-xl border p-3.5 text-xs flex items-start gap-2.5 transition-all ${
                phoneCheck.status === 'available'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : phoneCheck.status === 'own'
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                  : phoneCheck.status === 'reclaimable'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-rose-500/40 bg-rose-950/60 text-rose-200'
              }`}
            >
              {phoneCheck.status === 'available' && (
                <>
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-emerald-300">Número disponible para registro ({fullPhone})</p>
                    <p className="text-[11px] text-emerald-200/80 mt-0.5">
                      No existe en el CRM. Quedará asignado con exclusividad a tu cuenta.
                    </p>
                  </div>
                </>
              )}
              {phoneCheck.status === 'own' && (
                <>
                  <Sparkles size={15} className="text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-sky-300">Ya está asignado a tu cuenta ({phoneCheck.leadName})</p>
                    <p className="text-[11px] text-sky-200/80 mt-0.5">
                      Al guardar se actualizará su proyecto de interés y se agregará la nueva nota a su bitácora.
                    </p>
                  </div>
                </>
              )}
              {phoneCheck.status === 'reclaimable' && (
                <>
                  <RefreshCw size={15} className="text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-300">
                      Disponible para reclamar (&gt;30 días sin seguimiento activo)
                    </p>
                    <p className="text-[11px] text-amber-200/80 mt-0.5">
                      Este prospecto se encuentra libre por caducidad de exclusividad. Puedes reclamarlo y asignarlo directamente a tu cartera.
                    </p>
                  </div>
                </>
              )}
              {phoneCheck.status === 'locked_by_other' && (
                <>
                  <ShieldAlert size={16} className="text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 space-y-2.5">
                    {isAdmin ? (
                      <div>
                        <p className="font-semibold text-rose-300">
                          Asignado actualmente a {phoneCheck.advisorName || 'otro asesor'}
                        </p>
                        <p className="text-[11px] text-rose-200/90 mt-0.5">
                          Cliente: <strong>{phoneCheck.leadName}</strong> ·{' '}
                          {typeof phoneCheck.daysSinceActivity === 'number'
                            ? `Último seguimiento real hace ${phoneCheck.daysSinceActivity} día(s)`
                            : 'Sin ningún seguimiento registrado por el asesor'}
                          . Como Administrador puedes guardarlo para reasignarlo directamente.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="font-semibold text-rose-200 text-xs">
                          Este número ya está asignado a otro asesor
                        </p>
                        <p className="text-[11px] text-rose-200/80 mt-0.5 leading-relaxed">
                          Por políticas de exclusividad no puede registrarse nuevamente. Si estás atendiendo a este cliente, solicita el traslado al Administrador.
                        </p>
                      </div>
                    )}

                    {/* Botón y campo limpio para Solicitar Traslado (para asesores) */}
                    {!isAdmin && phoneCheck.leadId && (
                      <div className="pt-1 border-t border-rose-500/20">
                        {transferRequested ? (
                          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-2 text-emerald-200 text-[11px]">
                            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                            <span>
                              <strong>Solicitud enviada al Administrador.</strong> Te notificaremos apenas sea revisada y aprobada.
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={transferReason}
                              onChange={(e) => setTransferReason(e.target.value)}
                              placeholder="Motivo de la solicitud (ej: El cliente me contactó en sala de ventas)..."
                              className="w-full rounded-lg border border-rose-500/30 bg-zinc-900/90 px-2.5 py-1.5 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={handleRequestTransfer}
                              disabled={requestingTransfer}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[11px] shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Send size={12} />
                              {requestingTransfer ? 'Enviando solicitud...' : 'Solicitar Traslado al Administrador'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Nombre */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center gap-1.5">
              <User size={13} className="text-zinc-500" /> Nombre del Cliente
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Carlos Alberto Mendoza"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800/90 px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          {/* Fuente de Ubicación / Captación */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Compass size={13} className="text-emerald-400" /> Fuente de Ubicación / Origen *
              </span>
              <span className="text-[10px] text-zinc-500">¿De dónde viene el dato?</span>
            </label>
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800/90 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500/60 focus:outline-none"
              required
            >
              {sources.length > 0 ? (
                sources.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))
              ) : (
                <>
                  <option value="Trabajo de campo">Trabajo de campo</option>
                  <option value="Referidos">Referidos</option>
                  <option value="Redes Sociales">Redes Sociales</option>
                  <option value="PAUTA WHATSAPP 317">PAUTA WHATSAPP 317</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Página Web">Página Web</option>
                </>
              )}
            </select>
          </div>

          {/* Proyecto de Interés */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center gap-1.5">
              <Building2 size={13} className="text-zinc-500" /> Proyecto de Interés
            </label>
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800/90 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
            >
              {MERAKI_PROJECTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Asesor Asignado */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Asesor Asignado
            </label>
            {isAdmin ? (
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-800/90 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
              >
                {advisors.map((adv) => (
                  <option key={adv.id} value={adv.id}>
                    {adv.displayName} {adv.id === user?.uid ? '(Tú)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-xl border border-zinc-800 bg-zinc-800/50 px-3 py-2 text-xs text-zinc-300 flex items-center justify-between">
                <span>{user?.displayName || 'Asesor Actual'}</span>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Asignación Directa (Exclusiva)
                </span>
              </div>
            )}
          </div>

          {/* Observaciones iniciales */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center gap-1.5">
              <FileText size={13} className="text-zinc-500" /> Bitácora Inicial / ¿Cómo se captó?
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Captado en sala de ventas, referido de familiar, interesado en lote con vista..."
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800/90 p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          {/* Protocol Notice */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-200/90 leading-relaxed">
            <span className="font-semibold text-amber-300">🛡️ Protocolo de Exclusividad:</span> Este prospecto queda asignado de forma directa y no rota en el reparto público de pauta. Contará para tu meta comercial mensual.
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs shadow-md flex items-start gap-2.5">
              <span className="text-base shrink-0 mt-0.5">⚠️</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-rose-300">Atención</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-rose-200/90 whitespace-pre-wrap">{error}</p>
              </div>
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit}
              loading={saving}
              className="bg-amber-600 hover:bg-amber-500 text-white font-semibold"
            >
              <UserPlus size={14} />{' '}
              {phoneCheck?.status === 'reclaimable'
                ? 'Reclamar y Asignarme Prospecto'
                : phoneCheck?.status === 'own'
                ? 'Actualizar Mi Prospecto'
                : 'Crear Prospecto'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
