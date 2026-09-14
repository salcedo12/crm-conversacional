import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Save, Check } from 'lucide-react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import {
  getAutoCallConfig, saveAutoCallConfig, type AutoCallConfig,
} from '../services/autoCall.service';

/**
 * Panel de configuración del modo de llamadas IA automáticas. Solo visible para
 * admin de empresa y admin de plataforma (el propio callable lo re-valida).
 *
 * Cuando está activo, cada lead nuevo que entra por mensajería (con teléfono) se
 * llama automáticamente, respetando el horario diurno del país del lead. Si no
 * contesta, se reintenta según los offsets; si queda interesado sin cita, se
 * programa un seguimiento.
 */
export function AutoCallPanel() {
  const { companyId, role, platformAdmin } = useAuth();
  const canManage = platformAdmin || role === 'admin';

  const [cfg, setCfg]         = useState<AutoCallConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      setCfg(await getAutoCallConfig(companyId));
    } catch (err) {
      console.error('[AutoCallPanel]', err);
      setError('No se pudo cargar (¿functions desplegadas?).');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { if (canManage) void load(); }, [canManage, load]);

  if (!canManage) return null;

  const patch = (p: Partial<AutoCallConfig>) => setCfg((c) => (c ? { ...c, ...p } : c));

  const setOffset = (index: number, value: number) => {
    if (!cfg) return;
    const offsets = [...cfg.retryOffsetsHours];
    offsets[index] = value;
    patch({ retryOffsetsHours: offsets });
  };

  const save = async () => {
    if (!companyId || !cfg) return;
    setSaving(true);
    setError(null);
    try {
      await saveAutoCallConfig(companyId, cfg);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error('[AutoCallPanel] save', err);
      setError('No se pudo guardar. Revisa tus permisos e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-300">
            <Bot size={16} />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-100">Modo automático de llamadas</p>
            <p className="text-[11px] text-zinc-500">
              Llama solo a leads que escriben (con teléfono), en horario diurno de su país.
            </p>
          </div>
        </div>

        {loading ? (
          <Loader2 size={16} className="animate-spin text-zinc-500" />
        ) : cfg ? (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${cfg.enabled ? 'text-emerald-300' : 'text-zinc-500'}`}>
              {cfg.enabled ? 'Activo' : 'Apagado'}
            </span>
            <button
              onClick={() => patch({ enabled: !cfg.enabled })}
              role="switch"
              aria-checked={cfg.enabled}
              title={cfg.enabled ? 'Desactivar modo automático' : 'Activar modo automático'}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${cfg.enabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${cfg.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
              />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-300">{error ?? 'No se pudo cargar.'}</span>
            <button
              onClick={() => void load()}
              className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              Reintentar
            </button>
          </div>
        )}
      </div>

      {cfg && (
        <div className={`border-t border-zinc-800 px-4 py-3 transition-opacity ${cfg.enabled ? 'opacity-100' : 'opacity-50'}`}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Ventana horaria */}
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase text-zinc-500">
                Horario permitido (hora local del lead)
              </label>
              <div className="flex items-center gap-2 text-sm text-zinc-300">
                <HourInput value={cfg.windowStartHour} onChange={(v) => patch({ windowStartHour: v })} disabled={!cfg.enabled} />
                <span className="text-zinc-500">a</span>
                <HourInput value={cfg.windowEndHour} onChange={(v) => patch({ windowEndHour: v })} disabled={!cfg.enabled} />
              </div>
            </div>

            {/* Tope diario */}
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase text-zinc-500">
                Tope de llamadas por día
              </label>
              <input
                type="number" min={0} max={5000}
                value={cfg.dailyCap}
                onChange={(e) => patch({ dailyCap: Math.max(0, Number(e.target.value) || 0) })}
                disabled={!cfg.enabled}
                className="w-24 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-emerald-500/60 disabled:opacity-50"
              />
              <span className="ml-2 text-[11px] text-zinc-600">0 = sin tope</span>
            </div>

            {/* Reintentos */}
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="mb-1 block text-[11px] font-medium uppercase text-zinc-500">
                Reintentos si no contesta (horas desde el 1er intento)
              </label>
              <div className="flex items-center gap-2">
                {[0, 1, 2].map((i) => (
                  <input
                    key={i}
                    type="number" min={0} max={720}
                    value={cfg.retryOffsetsHours[i] ?? ''}
                    placeholder="—"
                    onChange={(e) => setOffset(i, Number(e.target.value) || 0)}
                    disabled={!cfg.enabled}
                    className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-emerald-500/60 disabled:opacity-50"
                  />
                ))}
                <span className="text-[11px] text-zinc-600">h</span>
              </div>
            </div>
          </div>

          {/* Seguimiento a interesados */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-800/60 pt-3">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={cfg.followUpInterestedEnabled}
                onChange={(e) => patch({ followUpInterestedEnabled: e.target.checked })}
                disabled={!cfg.enabled}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-emerald-500 disabled:opacity-50"
              />
              Seguimiento a interesados que no agendaron, a las
            </label>
            <input
              type="number" min={1} max={168}
              value={cfg.followUpInterestedHours}
              onChange={(e) => patch({ followUpInterestedHours: Math.max(1, Number(e.target.value) || 1) })}
              disabled={!cfg.enabled || !cfg.followUpInterestedEnabled}
              className="w-16 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-emerald-500/60 disabled:opacity-50"
            />
            <span className="text-sm text-zinc-500">horas</span>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />}
              {saved ? 'Guardado' : 'Guardar'}
            </button>
            {error && <span className="text-xs text-red-300">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function HourInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={disabled}
      className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-emerald-500/60 disabled:opacity-50"
    >
      {Array.from({ length: 25 }, (_, h) => (
        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
      ))}
    </select>
  );
}
