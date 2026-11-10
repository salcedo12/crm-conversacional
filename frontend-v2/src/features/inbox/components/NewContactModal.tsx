import { useState, useEffect } from 'react';
import { UserPlus, X, CheckCircle2, RefreshCw, ShieldAlert, Sparkles, Send } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { CountryPhoneInput } from '@/shared/components/CountryPhoneInput';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import {
  createContact,
  checkPhoneAvailability,
  requestLeadTransfer,
  buildInternationalPhone,
  type PhoneAvailabilityResult,
} from '../services/contacts.service';

interface NewContactModalProps {
  companyId: string;
  onClose: () => void;
  /** Se llama con el id del lead creado (o existente) para abrir su conversación. */
  onCreated: (leadId: string, existed: boolean) => void;
}

export function NewContactModal({ companyId, onClose, onCreated }: NewContactModalProps) {
  const { role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);

  const [name, setName]             = useState('');
  const [countryIso, setCountryIso] = useState('co');
  const [phone, setPhone]           = useState('');
  const [email, setEmail]           = useState('');
  const [company, setCompany]       = useState('');
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);

  const [checkingPhone, setCheckingPhone] = useState(false);
  const [phoneCheck, setPhoneCheck]       = useState<PhoneAvailabilityResult | null>(null);

  const [transferReason, setTransferReason]         = useState('');
  const [requestingTransfer, setRequestingTransfer] = useState(false);
  const [transferRequested, setTransferRequested]   = useState(false);

  const { fullPhone, isValidLength } = buildInternationalPhone(countryIso, phone);

  useEffect(() => {
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
  }, [fullPhone, isValidLength, companyId]);

  const isLockedForAdvisor = !isAdmin && phoneCheck?.status === 'locked_by_other';
  const canSubmit = isValidLength && !busy && !checkingPhone && !isLockedForAdvisor;

  const handleRequestTransfer = async () => {
    if (!companyId || !phoneCheck?.leadId || requestingTransfer) return;
    setRequestingTransfer(true);
    setError(null);
    try {
      await requestLeadTransfer({
        companyId,
        leadId: phoneCheck.leadId,
        phone: fullPhone,
        reason: transferReason.trim() || 'Solicitud de traslado desde Bandeja de Chats',
      });
      setTransferRequested(true);
    } catch (err: any) {
      setError(err?.message || 'No se pudo enviar la solicitud de traslado.');
    } finally {
      setRequestingTransfer(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { leadId, existed } = await createContact({
        companyId,
        name: name.trim() || undefined,
        phone: fullPhone,
        email: email.trim() || undefined,
        company: company.trim() || undefined,
      });
      onCreated(leadId, existed);
    } catch (err: any) {
      console.error('[NewContact] Error:', err);
      let msg = err?.message || 'No se pudo crear el contacto. Verifica el número e inténtalo de nuevo.';
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
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />

      <div
        className="relative z-10 w-full max-w-md overflow-hidden border border-zinc-800 bg-zinc-900 shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-600/20 text-violet-300">
              <UserPlus size={18} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Nuevo contacto</h3>
              <p className="mt-0.5 text-xs text-zinc-500">Agrégalo para iniciarle conversación por WhatsApp.</p>
            </div>
          </div>
          <button onClick={onClose} title="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
            <X size={17} />
          </button>
        </header>

        {/* Form */}
        <div className="flex flex-col gap-4 p-5">
          <div className="text-xs text-zinc-400">
            <div className="flex items-center justify-between mb-1.5">
              <span>Teléfono <span className="text-red-400">*</span></span>
              {checkingPhone ? (
                <span className="text-[10px] text-amber-300 flex items-center gap-1">
                  <RefreshCw size={10} className="animate-spin" /> Validando...
                </span>
              ) : fullPhone && isValidLength ? (
                <span className="text-[10px] font-mono text-emerald-400">{fullPhone}</span>
              ) : null}
            </div>
            <CountryPhoneInput
              countryIso={countryIso}
              onCountryChange={setCountryIso}
              phone={phone}
              onPhoneChange={setPhone}
              onEnter={handleSubmit}
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

          {phoneCheck && phoneCheck.status !== 'invalid' && (
            <div
              className={`rounded-xl border p-3 text-xs flex items-start gap-2.5 ${
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
                    <p className="font-semibold text-emerald-300">Número disponible ({fullPhone})</p>
                    <p className="text-[11px] text-emerald-200/80 mt-0.5">Se registrará con exclusividad a tu nombre.</p>
                  </div>
                </>
              )}
              {phoneCheck.status === 'own' && (
                <>
                  <Sparkles size={15} className="text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-sky-300">Ya está asignado a ti ({phoneCheck.leadName})</p>
                    <p className="text-[11px] text-sky-200/80 mt-0.5">Al continuar se abrirá directamente su chat.</p>
                  </div>
                </>
              )}
              {phoneCheck.status === 'reclaimable' && (
                <>
                  <RefreshCw size={15} className="text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-300">Disponible para reclamar (&gt;30 días sin seguimiento)</p>
                    <p className="text-[11px] text-amber-200/80 mt-0.5">
                      Puedes reclamarlo a tu cartera y abrir su chat inmediatamente.
                    </p>
                  </div>
                </>
              )}
              {phoneCheck.status === 'locked_by_other' && (
                <>
                  <ShieldAlert size={15} className="text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 space-y-2">
                    {isAdmin ? (
                      <div>
                        <p className="font-semibold text-rose-300">Asignado a {phoneCheck.advisorName}</p>
                        <p className="text-[11px] text-rose-200/90 mt-0.5">
                          Cliente: <strong>{phoneCheck.leadName}</strong> ·{' '}
                          {typeof phoneCheck.daysSinceActivity === 'number'
                            ? `Último seguimiento hace ${phoneCheck.daysSinceActivity} día(s)`
                            : 'Sin seguimiento registrado'}
                          .
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="font-semibold text-rose-200">Este número ya está asignado a otro asesor</p>
                        <p className="text-[11px] text-rose-200/80 mt-0.5">
                          Si estás atendiendo a este cliente, solicita el traslado al Administrador.
                        </p>
                      </div>
                    )}

                    {!isAdmin && phoneCheck.leadId && (
                      <div className="pt-1 border-t border-rose-500/20">
                        {transferRequested ? (
                          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1.5 text-emerald-200 text-[11px]">
                            <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                            <span>Solicitud enviada al Administrador.</span>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <input
                              type="text"
                              value={transferReason}
                              onChange={(e) => setTransferReason(e.target.value)}
                              placeholder="Motivo de la solicitud (opcional)..."
                              className="w-full rounded-lg border border-rose-500/30 bg-zinc-900/90 px-2.5 py-1.5 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={handleRequestTransfer}
                              disabled={requestingTransfer}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-[11px] shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Send size={12} />
                              {requestingTransfer ? 'Enviando...' : 'Solicitar Traslado'}
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

          <label className="text-xs text-zinc-400">
            Nombre
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej: Santiago Pérez"
              className="mt-1.5 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-xs text-zinc-400">
              Correo
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="opcional"
                className="mt-1.5 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
              />
            </label>
            <label className="text-xs text-zinc-400">
              Empresa
              <input
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="opcional"
                className="mt-1.5 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
              />
            </label>
          </div>

          <p className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-[11px] leading-4 text-zinc-500">
            💡 Como el contacto aún no te ha escrito, el primer mensaje debe ser una <span className="text-zinc-300">plantilla aprobada por WhatsApp</span>. Al crearlo se abre su chat con el envío de plantilla listo.
          </p>

          {error && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button size="sm" onClick={handleSubmit} loading={busy} disabled={!canSubmit}>
            {phoneCheck?.status === 'reclaimable'
              ? 'Reclamar e ir al chat'
              : phoneCheck?.status === 'own'
              ? 'Abrir mi chat'
              : 'Crear e ir al chat'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
