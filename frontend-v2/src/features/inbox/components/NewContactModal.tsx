import { useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { createContact } from '../services/contacts.service';

interface NewContactModalProps {
  companyId: string;
  onClose: () => void;
  /** Se llama con el id del lead creado (o existente) para abrir su conversación. */
  onCreated: (leadId: string, existed: boolean) => void;
}

export function NewContactModal({ companyId, onClose, onCreated }: NewContactModalProps) {
  const [name, setName]       = useState('');
  const [phone, setPhone]     = useState('');
  const [email, setEmail]     = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const phoneDigits = phone.replace(/\D/g, '');
  const canSubmit = phoneDigits.length >= 7 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { leadId, existed } = await createContact({
        companyId,
        name: name.trim() || undefined,
        phone: phone.trim(),
        email: email.trim() || undefined,
        company: company.trim() || undefined,
      });
      onCreated(leadId, existed);
    } catch (err) {
      const msg = (err as { message?: string })?.message;
      setError(msg || 'No se pudo crear el contacto. Verifica el número e inténtalo de nuevo.');
      console.error('[NewContact]', err);
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
          <label className="text-xs text-zinc-400">
            Nombre
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej: Santiago Pérez"
              className="mt-1.5 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
            />
          </label>

          <label className="text-xs text-zinc-400">
            Teléfono <span className="text-red-400">*</span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') handleSubmit(); }}
              placeholder="+57 300 111 2233"
              inputMode="tel"
              className="mt-1.5 h-10 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
            />
            <span className="mt-1 block text-[11px] text-zinc-600">
              Formato internacional. Los celulares de Colombia (3XXXXXXXXX) se completan a +57 automáticamente.
            </span>
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
        <footer className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button size="sm" onClick={handleSubmit} loading={busy} disabled={!canSubmit}>
            Crear e ir al chat
          </Button>
        </footer>
      </div>
    </div>
  );
}
