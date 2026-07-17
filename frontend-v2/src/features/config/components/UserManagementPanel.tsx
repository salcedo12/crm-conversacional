import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2, Mail, Plus, Save } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import {
  createCompanyUser,
  listCompanyUsers,
  updateCompanyUser,
  type CompanyUser,
} from '@/features/leads/services/advisors.service';

const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'advisor', label: 'Asesor' },
  { value: 'viewer', label: 'Solo lectura' },
];

const inputClass = 'h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60';

export function UserManagementPanel({ companyId }: { companyId: string }) {
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    email: string;
    displayName: string;
    link: string | null;
    emailSent: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState({ email: '', displayName: '', role: 'advisor', active: true });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listCompanyUsers(companyId));
    } catch (err) {
      console.error('[UsersPanel] load error:', err);
      setError('No se pudieron cargar los usuarios.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!draft.email.trim() || !draft.displayName.trim()) return;
    const email = draft.email.trim();
    const displayName = draft.displayName.trim();
    setSavingId('new');
    setError(null);
    setInvite(null);
    setCopied(false);
    try {
      const result = await createCompanyUser({ companyId, ...draft, email, displayName });
      setInvite({ email, displayName, link: result.inviteLink, emailSent: result.emailSent === true });
      setDraft({ email: '', displayName: '', role: 'advisor', active: true });
      await load();
    } catch (err) {
      console.error('[UsersPanel] create error:', err);
      setError('No se pudo crear o invitar el usuario.');
    } finally {
      setSavingId('');
    }
  };

  const copyInviteLink = async () => {
    if (!invite?.link) return;
    await navigator.clipboard.writeText(invite.link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const update = async (user: CompanyUser) => {
    setSavingId(user.id);
    setError(null);
    try {
      await updateCompanyUser({
        companyId,
        userId: user.id,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
      });
      await load();
    } catch (err) {
      console.error('[UsersPanel] update error:', err);
      setError('No se pudo actualizar el usuario.');
    } finally {
      setSavingId('');
    }
  };

  const patchUser = (id: string, patch: Partial<CompanyUser>) => {
    setUsers((current) => current.map((user) => user.id === id ? { ...user, ...patch } : user));
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Usuarios y asesores</h2>
        <p className="mt-1 text-xs text-zinc-500">Crea accesos, cambia roles y activa o desactiva asesores.</p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <p className="mb-3 text-xs font-medium text-zinc-300">Invitar usuario</p>
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_140px_auto]">
          <input className={inputClass} value={draft.email} onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))} placeholder="correo@empresa.com" />
          <input className={inputClass} value={draft.displayName} onChange={(event) => setDraft((prev) => ({ ...prev, displayName: event.target.value }))} placeholder="Nombre visible" />
          <select className={inputClass} value={draft.role} onChange={(event) => setDraft((prev) => ({ ...prev, role: event.target.value }))}>
            {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
          <Button size="sm" onClick={create} loading={savingId === 'new'} disabled={!draft.email.trim() || !draft.displayName.trim()}>
            <Plus size={14} /> Invitar
          </Button>
        </div>
        {invite && (
          <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
                  {invite.emailSent ? <CheckCircle2 size={16} /> : <Mail size={16} />}
                  {invite.emailSent ? 'Invitacion Meraki enviada por correo' : 'Usuario creado, correo no enviado'}
                </div>
                <p className="mt-1 text-xs text-emerald-100/85">
                  {invite.displayName} recibira un correo en <span className="font-medium text-emerald-50">{invite.email}</span> con el boton para crear su contrasena y entrar al CRM.
                </p>
                {!invite.emailSent && (
                  <p className="mt-2 text-xs text-amber-200">
                    No se pudo enviar el correo automatico. Usa el enlace de respaldo para compartir la invitacion.
                  </p>
                )}
              </div>

              {invite.link && (
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={copyInviteLink}>
                    <Copy size={14} /> {copied ? 'Copiado' : 'Copiar link'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => window.open(invite.link ?? '', '_blank', 'noopener,noreferrer')}>
                    <ExternalLink size={14} /> Abrir
                  </Button>
                </div>
              )}
            </div>

            {invite.link && (
              <div className="mt-3 rounded-md border border-emerald-500/15 bg-black/20 px-3 py-2">
                <p className="truncate text-[11px] text-emerald-100/80">{invite.link}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-zinc-500" size={20} /></div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          {users.map((user) => (
            <div key={user.id} className="grid gap-2 border-b border-zinc-800 bg-zinc-900/30 p-3 last:border-b-0 md:grid-cols-[1fr_150px_110px_auto]">
              <div className="min-w-0">
                <input className={`${inputClass} w-full`} value={user.displayName} onChange={(event) => patchUser(user.id, { displayName: event.target.value })} />
                <p className="mt-1 truncate text-[11px] text-zinc-500">{user.email || user.id}{user.googleConnected ? ' - Calendar conectado' : ''}</p>
              </div>
              <select className={inputClass} value={user.role} onChange={(event) => patchUser(user.id, { role: event.target.value })}>
                {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
              <label className="flex h-9 items-center gap-2 rounded-md border border-zinc-800 px-3 text-xs text-zinc-300">
                <input type="checkbox" checked={user.active} onChange={(event) => patchUser(user.id, { active: event.target.checked })} />
                Activo
              </label>
              <Button size="sm" variant="secondary" onClick={() => update(user)} loading={savingId === user.id}>
                <Save size={14} /> Guardar
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
