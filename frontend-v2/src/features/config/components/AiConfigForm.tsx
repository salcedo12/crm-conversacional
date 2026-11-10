import { useMemo, useState } from 'react';
import { FileText, ListTree }        from 'lucide-react';
import { Button }                  from '@/shared/components/Button';
import { FormField }               from './FormField';
import { TagListInput }            from './TagListInput';
import { FollowUpSequenceEditor }  from './FollowUpSequenceEditor';
import { AiTestChat }              from './AiTestChat';
import { AiStatusPanel, Switch }   from './AiStatusPanel';
import { AiPricingPanel }          from './AiPricingPanel';
import { AiReportPanel }           from './AiReportPanel';
import type { AgentProfile, AiConfigDraft, AiTone } from '../types';

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna — recomendado' },
  { value: 'gpt-4o-mini',  label: 'GPT-4o mini — respaldo si Luna falla' },
];

interface AiConfigFormProps {
  companyId: string;
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

type PromptSection = {
  id: string;
  title: string;
  content: string;
};

function parsePromptSections(prompt: string): PromptSection[] {
  const matches = [...prompt.matchAll(/^##\s+\d+\.\s+.+$/gm)];
  if (matches.length === 0) {
    return [{ id: 'full', title: 'Prompt completo', content: prompt }];
  }

  const sections: PromptSection[] = [];
  const firstIndex = matches[0].index ?? 0;
  const intro = prompt.slice(0, firstIndex).trim();
  if (intro) {
    sections.push({ id: 'intro', title: 'Encabezado', content: intro });
  }

  matches.forEach((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? prompt.length) : prompt.length;
    const content = prompt.slice(start, end).trim();
    const title = match[0]
      .replace(/^##\s+/, '')
      .replace(/^\d+\.\s*/, '')
      .trim();
    sections.push({ id: `section-${index}`, title, content });
  });

  return sections;
}

function replacePromptSection(prompt: string, sectionId: string, nextContent: string): string {
  const sections = parsePromptSections(prompt);
  const next = sections.map((section) =>
    section.id === sectionId ? { ...section, content: nextContent.trimEnd() } : section
  );
  return next.map((section) => section.content.trim()).filter(Boolean).join('\n\n');
}

export function AiConfigForm({
  companyId, draft, status, error, isDirty, onUpdate, onSave, onReset,
}: AiConfigFormProps) {
  const saving = status === 'saving';
  const saved  = status === 'saved';
  const [promptMode, setPromptMode] = useState<'sections' | 'full'>('sections');
  const sections = useMemo(() => parsePromptSections(draft.basePrompt), [draft.basePrompt]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>('intro');
  const selectedSection = sections.find((section) => section.id === selectedSectionId) ?? sections[0];

  const updatePromptSection = (sectionId: string, content: string) => {
    onUpdate('basePrompt', replacePromptSection(draft.basePrompt, sectionId, content));
  };

  return (
    <div className="flex flex-col gap-8">

      <AiStatusPanel draft={draft} onUpdate={onUpdate} />

      <AiReportPanel companyId={companyId} />

      {/* ── Sección: General ────────────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Identidad y modelo
          </h3>
          <p className="mt-1 text-xs text-zinc-500">Quién es tu asistente, cómo suena y con qué reglas trabaja.</p>
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

        {/* Nombre del negocio */}
        <FormField
          label="Nombre del negocio"
          htmlFor="businessName"
          hint="Aparece en las confirmaciones y recordatorios de citas"
        >
          <input
            id="businessName"
            type="text"
            value={draft.businessName}
            onChange={(e) => onUpdate('businessName', e.target.value)}
            placeholder="Grupo Constructor Meraki"
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

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Reglas de venta" htmlFor="agentProfile" hint="Cómo atiende y cotiza">
            <select
              id="agentProfile"
              value={draft.agentProfile ?? 'legacy'}
              onChange={(e) => onUpdate('agentProfile', e.target.value as AgentProfile)}
              className={inputClass}
            >
              <option value="consultive">Asesoría consultiva — plazos 20/30/40, objeciones, Sobre Montañas</option>
              <option value="legacy">Anterior — reglas originales</option>
            </select>
          </FormField>

          <FormField label="Modelo de IA" htmlFor="model">
            <select
              id="model"
              value={draft.model ?? 'gpt-5.6-luna'}
              onChange={(e) => onUpdate('model', e.target.value)}
              disabled={draft.agentProfile !== 'consultive'}
              className={`${inputClass} disabled:opacity-50`}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </FormField>
        </div>
        {draft.agentProfile !== 'consultive' && (
          <p className="-mt-3 text-xs text-amber-400">
            Las reglas anteriores usan GPT-4o mini y no incluyen lo trabajado: plazos 20/30/40, objeciones de precio, Sobre Montañas ni detección de compradores.
          </p>
        )}

        <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-700/50 bg-zinc-800/60 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-zinc-100">Notas de voz</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Bienvenida en audio y respuesta en audio cuando el cliente envía una nota de voz (solo WhatsApp).
            </p>
          </div>
          <Switch checked={draft.voiceEnabled === true} onChange={(v) => onUpdate('voiceEnabled', v)} label="Notas de voz" />
        </div>
      </section>

      <AiPricingPanel draft={draft} onUpdate={onUpdate} />

      {/* ── Sección: Prompt principal ────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <div>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Cómo debe contestar
            </h3>
            <p className="mt-1 text-xs text-zinc-500">Lo más importante: aquí defines qué dice y cómo se comporta la IA.</p>
          </div>
          <span className="shrink-0 text-[10px] text-zinc-600">
            {draft.basePrompt.length} / 100 000 caracteres
          </span>
        </div>

        {/* Guía rápida para escribir buenas instrucciones */}
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-xs leading-relaxed text-zinc-400">
          <p className="mb-1.5 font-medium text-violet-200">💡 Cómo escribir buenas instrucciones</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>Háblale de “tú” a la IA: <span className="text-zinc-300">“Eres el asistente de… Tu objetivo es…”</span></li>
            <li>Di <span className="text-zinc-300">qué hacer</span> y también <span className="text-zinc-300">qué NO hacer</span> (ej: “nunca inventes precios”).</li>
            <li>Pon ejemplos de respuestas ideales para casos comunes.</li>
            <li>Los precios, horarios y FAQs mejor ponlos en <span className="text-zinc-300">Base de conocimiento</span> (abajo).</li>
          </ul>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-zinc-200">Instrucciones base del asistente</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Edita el prompt por partes; se guarda como un solo texto para la IA.
              </p>
            </div>
            <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900 p-1">
              <button
                type="button"
                onClick={() => setPromptMode('sections')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  promptMode === 'sections'
                    ? 'bg-violet-500/15 text-violet-200'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <ListTree className="h-3.5 w-3.5" />
                Secciones
              </button>
              <button
                type="button"
                onClick={() => setPromptMode('full')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  promptMode === 'full'
                    ? 'bg-violet-500/15 text-violet-200'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                Texto completo
              </button>
            </div>
          </div>

          {promptMode === 'sections' ? (
            <div className="grid min-h-[520px] grid-cols-[240px_minmax(0,1fr)] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
              <div className="border-r border-zinc-800 bg-zinc-950/50 p-2">
                <div className="mb-2 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Partes del prompt
                </div>
                <div className="flex max-h-[496px] flex-col gap-1 overflow-y-auto pr-1">
                  {sections.map((section, index) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setSelectedSectionId(section.id)}
                      className={`rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                        selectedSection?.id === section.id
                          ? 'bg-violet-500/15 text-violet-100'
                          : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'
                      }`}
                    >
                      <span className="block truncate font-medium">
                        {section.id === 'intro' ? 'Encabezado' : `${index}. ${section.title}`}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-zinc-600">
                        {section.content.length} caracteres
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex min-w-0 flex-col">
                <div className="border-b border-zinc-800 px-4 py-3">
                  <p className="text-sm font-semibold text-zinc-100">{selectedSection?.title ?? 'Prompt'}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Esta seccion se une automaticamente con las demas al guardar.
                  </p>
                </div>
                <textarea
                  value={selectedSection?.content ?? draft.basePrompt}
                  onChange={(e) => selectedSection && updatePromptSection(selectedSection.id, e.target.value)}
                  rows={22}
                  className="min-h-[444px] flex-1 resize-none border-0 bg-zinc-900 px-4 py-3 font-mono text-xs leading-relaxed text-zinc-100 outline-none placeholder-zinc-500"
                />
              </div>
            </div>
          ) : (
            <textarea
              value={draft.basePrompt}
              onChange={(e) => onUpdate('basePrompt', e.target.value)}
              rows={22}
              className={`${inputClass} font-mono text-xs leading-relaxed resize-y`}
            />
          )}
        </div>

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

        {/* Chat de prueba: usa el prompt/base de arriba (aunque no esté guardado). */}
        <AiTestChat
          companyId={companyId}
          basePrompt={draft.basePrompt}
          knowledgeBase={draft.knowledgeBase}
        />
      </section>

      {/* ── Sección: Comportamiento ─────────────────────────────────── */}
      <section className="flex flex-col gap-5">
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Comportamiento
          </h3>
          <p className="mt-1 text-xs text-zinc-500">Reglas de seguridad: cuándo pasar a un humano y qué temas evitar.</p>
        </div>

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

      <div className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-t border-zinc-800 bg-zinc-950/95 px-6 py-4 backdrop-blur">
        <Button
          onClick={onSave}
          disabled={!isDirty || saving}
          loading={saving}
          size="md"
        >
          {saved ? '✓ Guardado' : 'Guardar cambios'}
        </Button>

        <Button
          onClick={() => {
            if (window.confirm('Se reemplazarán las instrucciones por las originales del sistema. Lo demás (estado, piloto, precios) no cambia. ¿Continuar?')) onReset();
          }}
          disabled={saving}
          variant="secondary"
          size="md"
        >
          Restaurar instrucciones originales
        </Button>

        {saved && !isDirty && (
          <span className="ml-auto text-xs text-emerald-400">✓ Cambios guardados</span>
        )}
        {isDirty && !saving && (
          <span className="ml-auto text-xs text-amber-400">● Cambios sin guardar</span>
        )}
      </div>
    </div>
  );
}
