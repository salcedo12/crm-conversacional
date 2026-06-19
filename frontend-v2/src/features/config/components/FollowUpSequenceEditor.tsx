import type { FollowUpStep } from '../types';

interface FollowUpSequenceEditorProps {
  steps:    FollowUpStep[];
  onChange: (steps: FollowUpStep[]) => void;
}

type TimeUnit = 'minutes' | 'hours' | 'days';

/** Convierte minutos → valor + unidad más legible */
function fromMinutes(totalMinutes: number): { value: number; unit: TimeUnit } {
  if (totalMinutes % 1440 === 0) return { value: totalMinutes / 1440, unit: 'days'    };
  if (totalMinutes % 60   === 0) return { value: totalMinutes / 60,   unit: 'hours'   };
  return                                { value: totalMinutes,         unit: 'minutes' };
}

/** Convierte valor + unidad → minutos */
function toMinutes(value: number, unit: TimeUnit): number {
  if (unit === 'days')    return value * 1440;
  if (unit === 'hours')   return value * 60;
  return value;
}

const UNIT_OPTIONS: { value: TimeUnit; label: string }[] = [
  { value: 'minutes', label: 'Minutos' },
  { value: 'hours',   label: 'Horas'   },
  { value: 'days',    label: 'Días'    },
];

const MAX_STEPS = 5;

export function FollowUpSequenceEditor({ steps, onChange }: FollowUpSequenceEditorProps) {

  const addStep = () => {
    if (steps.length >= MAX_STEPS) return;
    const lastDelay = steps[steps.length - 1]?.delayMinutes ?? 0;
    onChange([...steps, { delayMinutes: lastDelay + 240, enabled: true }]);
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, patch: Partial<FollowUpStep>) => {
    onChange(steps.map((s, i) => i === index ? { ...s, ...patch } : s));
  };

  const updateTime = (index: number, value: number, unit: TimeUnit) => {
    const minutes = toMinutes(Math.max(1, value), unit);
    updateStep(index, { delayMinutes: minutes });
  };

  const inputClass = `
    w-20 rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-2
    text-sm text-zinc-100 text-center
    focus:outline-none focus:border-violet-500/50 transition-colors
  `;

  const selectClass = `
    rounded-lg bg-zinc-800 border border-zinc-700 px-2.5 py-2
    text-sm text-zinc-100
    focus:outline-none focus:border-violet-500/50 transition-colors
  `;

  return (
    <div className="flex flex-col gap-3">
      {steps.length === 0 && (
        <p className="text-xs text-zinc-500 italic">
          Sin seguimientos configurados. Agrega uno para que la IA escriba automáticamente si el lead no responde.
        </p>
      )}

      {steps.map((step, index) => {
        const { value, unit } = fromMinutes(step.delayMinutes);

        return (
          <div
            key={index}
            className={`
              rounded-xl border p-4 flex flex-col gap-3 transition-colors
              ${step.enabled
                ? 'border-zinc-700 bg-zinc-800/50'
                : 'border-zinc-800 bg-zinc-900/50 opacity-60'
              }
            `}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300">
                Seguimiento {index + 1}
              </span>
              <button
                type="button"
                onClick={() => removeStep(index)}
                className="text-zinc-600 hover:text-red-400 transition-colors text-sm"
                title="Eliminar seguimiento"
              >
                🗑
              </button>
            </div>

            {/* Tiempo */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={unit === 'minutes' ? 59 : unit === 'hours' ? 23 : 7}
                value={value}
                onChange={(e) => updateTime(index, Number(e.target.value), unit)}
                className={inputClass}
              />
              <select
                value={unit}
                onChange={(e) => updateTime(index, value, e.target.value as TimeUnit)}
                className={selectClass}
              >
                {UNIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="text-xs text-zinc-500">sin respuesta</span>
            </div>

            {/* Checkbox: permitir que IA envíe */}
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={step.enabled}
                onChange={(e) => updateStep(index, { enabled: e.target.checked })}
                className="w-3.5 h-3.5 accent-violet-500 rounded"
              />
              <span className="text-xs text-zinc-400 group-hover:text-zinc-200 transition-colors">
                Permitir que la IA envíe el mensaje
              </span>
            </label>
          </div>
        );
      })}

      {/* Botón agregar */}
      {steps.length < MAX_STEPS && (
        <button
          type="button"
          onClick={addStep}
          className="
            flex items-center gap-2 text-xs text-zinc-400 hover:text-violet-300
            border border-dashed border-zinc-700 hover:border-violet-500/40
            rounded-xl px-4 py-3 transition-colors w-full justify-center
          "
        >
          + Agregar seguimiento
          <span className="text-zinc-600">({steps.length}/{MAX_STEPS})</span>
        </button>
      )}
    </div>
  );
}
