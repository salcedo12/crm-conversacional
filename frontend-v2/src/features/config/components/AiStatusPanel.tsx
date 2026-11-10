import { TagListInput } from './TagListInput';
import type { AiConfigDraft, AiRollout } from '../types';

interface AiStatusPanelProps {
  draft:    AiConfigDraft;
  onUpdate: <K extends keyof AiConfigDraft>(key: K, value: AiConfigDraft[K]) => void;
}

type RolloutMode = 'test' | 'new' | 'all';

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'whatsapp',   label: 'WhatsApp directo' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'meta_ads',   label: 'Meta (Facebook / Instagram)' },
  { value: 'web',        label: 'Página web' },
  { value: 'instagram',  label: 'Instagram (mensajes)' },
  { value: 'facebook',   label: 'Messenger' },
];

const TZ_OFFSET = '-05:00'; // Colombia, sin horario de verano

function modeOf(rollout: AiRollout | null): RolloutMode {
  if (!rollout) return 'all';
  return rollout.startAt ? 'new' : 'test';
}

function toDateInput(ms: number | null): string {
  if (!ms) return '';
  return new Date(ms - 5 * 3600_000).toISOString().slice(0, 10);
}

function fromDateInput(value: string): number | null {
  return value ? new Date(`${value}T00:00:00${TZ_OFFSET}`).getTime() : null;
}

/** Deja solo dígitos y un "+" inicial. */
function cleanPhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-violet-600' : 'bg-zinc-600'
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

export { Switch };

/** Interruptor general de la IA y a quién responde (piloto). */
export function AiStatusPanel({ draft, onUpdate }: AiStatusPanelProps) {
  const rollout = draft.rollout;
  const mode = modeOf(rollout);
  const base: AiRollout = rollout ?? { testPhones: [], startAt: null, sources: [] };

  const setMode = (next: RolloutMode) => {
    if (next === mode) return;
    if (next === 'all') {
      const ok = window.confirm(
        'Sin piloto, la IA responderá a TODOS los leads que tengan la IA activa, incluidos los que ya atienden los asesores. ¿Continuar?'
      );
      if (ok) onUpdate('rollout', null);
      return;
    }
    if (next === 'test') onUpdate('rollout', { ...base, startAt: null });
    if (next === 'new') onUpdate('rollout', { ...base, startAt: base.startAt ?? fromDateInput(toDateInput(Date.now())) });
  };

  const toggleEnabled = (value: boolean) => {
    if (value && mode === 'all') {
      const ok = window.confirm('Vas a encender la IA para TODOS los leads (no hay piloto). ¿Continuar?');
      if (!ok) return;
    }
    onUpdate('enabled', value);
  };

  const toggleSource = (source: string) => {
    const sources = base.sources.includes(source)
      ? base.sources.filter((s) => s !== source)
      : [...base.sources, source];
    onUpdate('rollout', { ...base, sources });
  };

  const summary = !draft.enabled
    ? 'La IA está apagada: no le responde a nadie.'
    : mode === 'all'
      ? 'La IA responde a todos los leads que tengan la IA activa.'
      : mode === 'test'
        ? `La IA responde solo a ${base.testPhones.length || 'ningún'} número${base.testPhones.length === 1 ? '' : 's'} de prueba.`
        : `La IA responde a los números de prueba y a los leads nuevos desde el ${toDateInput(base.startAt)}${
          base.sources.length ? ` que lleguen por: ${base.sources.map((s) => SOURCE_OPTIONS.find((o) => o.value === s)?.label ?? s).join(', ')}` : ' (todos los orígenes)'
        }.`;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Estado de la IA</h3>
        <p className="mt-1 text-xs text-zinc-500">Si responde y a quién. Los cambios aplican apenas guardas, sin desplegar nada.</p>
      </div>

      <div className={`rounded-xl border px-4 py-3 ${draft.enabled ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-700/50 bg-zinc-800/60'}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-100">IA encendida para la empresa</p>
            <p className="mt-0.5 text-xs text-zinc-500">Interruptor general. Apagado, la IA no responde a nadie.</p>
          </div>
          <Switch checked={draft.enabled} onChange={toggleEnabled} label="IA encendida para la empresa" />
        </div>
        <p className={`mt-3 text-xs font-medium ${draft.enabled ? 'text-emerald-300' : 'text-zinc-400'}`}>{summary}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-zinc-700/50 bg-zinc-800/40 px-4 py-4">
        <p className="text-xs font-semibold text-zinc-300">¿A quién responde?</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            ['test', 'Solo números de prueba', 'Para evaluarla sin tocar clientes'],
            ['new', 'Piloto con leads nuevos', 'Desde una fecha y por origen'],
            ['all', 'Todos los leads', 'Sin restricciones'],
          ] as const).map(([value, label, desc]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                mode === value
                  ? 'border-violet-500/40 bg-violet-500/10 text-violet-200'
                  : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
              }`}
            >
              <p className="font-medium">{label}</p>
              <p className="mt-0.5 leading-tight text-zinc-500">{desc}</p>
            </button>
          ))}
        </div>

        {mode !== 'all' && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-zinc-300">
              Números de prueba <span className="text-zinc-500">— con indicativo, ej. +573001234567. No pueden ser números de usuarios del CRM.</span>
            </p>
            <TagListInput
              value={base.testPhones}
              onChange={(phones) => onUpdate('rollout', { ...base, testPhones: phones.map(cleanPhone).filter((p) => p.replace(/\D/g, '').length >= 10) })}
              placeholder="+573001234567 y Enter"
            />
          </div>
        )}

        {mode === 'new' && (
          <>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-zinc-300">
                Leads creados desde <span className="text-zinc-500">— los anteriores siguen con su asesor</span>
              </p>
              <input
                type="date"
                value={toDateInput(base.startAt)}
                onChange={(e) => onUpdate('rollout', { ...base, startAt: fromDateInput(e.target.value) })}
                className="w-48 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500/50 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-zinc-300">
                Orígenes <span className="text-zinc-500">— si no marcas ninguno, aplica a todos</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {SOURCE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-3 py-1.5 text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={base.sources.includes(opt.value)}
                      onChange={() => toggleSource(opt.value)}
                      className="h-3.5 w-3.5 accent-violet-500"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
