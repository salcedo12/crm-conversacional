import { Button }                  from '@/shared/components/Button';
import { FormField }               from './FormField';
import { TagListInput }            from './TagListInput';
import { FollowUpSequenceEditor }  from './FollowUpSequenceEditor';
import type { AiConfigDraft, AiTone } from '../types';

interface AiConfigFormProps {
  draft:    AiConfigDraft;
  status:   'idle' | 'loading' | 'saving' | 'saved' | 'error';
  error:    string | null;
  isDirty:  boolean;
  onUpdate: <K extends keyof AiConfigDraft>(key: K, value: AiConfigDraft[K]) => void;
  onSave:   () => void;
  onReset:  () => void;
}

const TONE_OPTIONS: { value: AiTone; label: string; desc: string }[] = [
  { value: 'professional', label: 'Profesional', desc: 'Formal pero cercano — ideal para ventas inmobiliarias' },
  { value: 'friendly',     label: 'Amigable',    desc: 'Cálido y conversacional'                              },
  { value: 'formal',       label: 'Formal',      desc: 'Corporativo y distante'                               },
  { value: 'casual',       label: 'Casual',      desc: 'Relajado, como hablar con un amigo'                   },
];

const inputClass = `
  w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2
  text-sm text-zinc-100 placeholder-zinc-500
  focus:outline-none focus:border-violet-500/50 transition-colors
`;

export function AiConfigForm({
  draft, status, error, isDirty, onUpdate, onSave, onReset,
}: AiConfigFormProps) {
  const saving = status === 'saving';
  const saved  = status === 'saved';

  return (
    <div className="flex flex-col gap-8">

      {/* ── Sección: General ────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          General
        </h3>

        {/* Enable toggle */}
        <div className="flex items-center justify-between rounded-xl bg-zinc-800/60 border border-zinc-700/50 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-zinc-100">IA activa por defecto</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Los leads nuevos tendrán la IA encendida automáticamente
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            onClick={() => onUpdate('enabled', !draft.enabled)}
            className={`
              relative inline-flex h-6 w-11 shrink-0 items-center rounded-full
              transition-colors focus:outline-none
              ${draft.enabled ? 'bg-violet-600' : 'bg-zinc-600'}
            `}
          >
            <span
              className={`
                inline-block h-4 w-4 rounded-full bg-white shadow transition-transform
                ${draft.enabled ? 'translate-x-6' : 'translate-x-1'}
              `}
            />
          </button>
        </div>

        {/* Nombre del asistente */}
        <FormField label="Nombre del asistente" htmlFor="assistantName">
          <input
            id="assistantName"
            type="text"
            value={draft.assistantName}
            onChange={(e) => onUpdate('assistantName', e.target.value)}
            placeholder="Victoria Sarmiento"
            className={inputClass}
          />
        </FormField>

        {/* Tono */}
        <FormField label="Tono de comunicación" htmlFor="tone">
          <div className="grid grid-cols-2 gap-2">
            {TONE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onUpdate('tone', opt.value)}
                className={`
                  text-left px-3 py-2.5 rounded-lg border text-xs transition-colors
                  ${draft.tone === opt.value
                    ? 'border-violet-500/40 bg-violet-500/10 text-violet-200'
                    : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                  }
                `}
              >
                <p className="font-medium">{opt.label}</p>
                <p className="text-zinc-500 mt-0.5 leading-tight">{opt.desc}</p>
              </button>
            ))}
          </div>
        </FormField>
      </section>

      {/* ── Sección: Prompt principal ────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Prompt principal
          </h3>
          <span className="text-[10px] text-zinc-600">
            {draft.basePrompt.length} / 20 000 caracteres
          </span>
        </div>

        <FormField
          label="Instrucciones base del asistente"
          hint="Define personalidad, flujos, restricciones y conocimiento del producto"
        >
          <textarea
            value={draft.basePrompt}
            onChange={(e) => onUpdate('basePrompt', e.target.value)}
            rows={18}
            className={`${inputClass} font-mono text-xs leading-relaxed resize-y`}
          />
        </FormField>

        <FormField
          label="Base de conocimiento adicional"
          hint="Información extra: precios, FAQs, horarios, etc."
        >
          <textarea
            value={draft.knowledgeBase}
            onChange={(e) => onUpdate('knowledgeBase', e.target.value)}
            rows={6}
            placeholder="Ejemplo: Precios actualizados desde enero 2025..."
            className={`${inputClass} font-mono text-xs leading-relaxed resize-y`}
          />
        </FormField>
      </section>

      {/* ── Sección: Comportamiento ─────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Comportamiento
        </h3>

        {/* Fallback */}
        <FormField
          label="Mensaje de fallback"
          hint="Se envía si OpenAI falla o no hay respuesta"
        >
          <textarea
            value={draft.fallbackMessage}
            onChange={(e) => onUpdate('fallbackMessage', e.target.value)}
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </FormField>

        {/* Max context */}
        <FormField
          label="Mensajes de contexto"
          hint={`Cuántos mensajes previos se incluyen en cada llamada a OpenAI (${draft.maxContextMessages})`}
          htmlFor="maxContext"
        >
          <input
            id="maxContext"
            type="range"
            min={5}
            max={50}
            step={5}
            value={draft.maxContextMessages}
            onChange={(e) => onUpdate('maxContextMessages', Number(e.target.value))}
            className="w-full accent-violet-500 h-2 rounded-lg"
          />
          <div className="flex justify-between text-[10px] text-zinc-600 -mt-1">
            <span>5 (más rápido)</span>
            <span className="text-violet-400 font-medium">{draft.maxContextMessages}</span>
            <span>50 (más contexto)</span>
          </div>
        </FormField>

        {/* Transfer keywords */}
        <FormField
          label="Palabras clave de transferencia"
          hint="Al detectarlas, la IA notifica que un asesor tomará el control"
        >
          <TagListInput
            value={draft.transferKeywords}
            onChange={(tags) => onUpdate('transferKeywords', tags)}
            placeholder="asesor, humano, hablar con alguien..."
          />
        </FormField>

        {/* Blocked topics */}
        <FormField
          label="Temas bloqueados"
          hint="La IA rechazará hablar de estos temas"
        >
          <TagListInput
            value={draft.blockedTopics}
            onChange={(tags) => onUpdate('blockedTopics', tags)}
            placeholder="competencia, política, religión..."
          />
        </FormField>
      </section>

      {/* ── Sección: Seguimientos automáticos ───────────────────────── */}
      <section className="flex flex-col gap-5">
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Secuencia de seguimiento
          </h3>
          <p className="text-xs text-zinc-500 mt-1">
            Si el lead no responde, la IA enviará mensajes automáticos en los intervalos configurados.
            Configure hasta {5} seguimientos.
          </p>
        </div>

        <FollowUpSequenceEditor
          steps={draft.followUpSequence ?? []}
          onChange={(steps) => onUpdate('followUpSequence', steps)}
        />
      </section>

      {/* ── Acciones ─────────────────────────────────────────────────── */}
      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 pt-2 pb-6">
        <Button
          onClick={onSave}
          disabled={!isDirty || saving}
          loading={saving}
          size="md"
        >
          {saved ? '✓ Guardado' : 'Guardar cambios'}
        </Button>

        <Button
          onClick={onReset}
          disabled={saving}
          variant="secondary"
          size="md"
        >
          Restaurar prompt original
        </Button>

        {isDirty && !saving && (
          <span className="text-xs text-amber-400 ml-auto">● Cambios sin guardar</span>
        )}
      </div>
    </div>
  );
}
