import { FormField } from './FormField';
import { Switch } from './AiStatusPanel';
import type { AiConfigDraft } from '../types';

interface AiPricingPanelProps {
  draft:    AiConfigDraft;
  onUpdate: <K extends keyof AiConfigDraft>(key: K, value: AiConfigDraft[K]) => void;
}

const inputClass = `
  w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2
  text-sm text-zinc-100 placeholder-zinc-500
  focus:outline-none focus:border-violet-500/50 transition-colors
`;

const money = (n: number | undefined) => (n ? `$${n.toLocaleString('es-CO')}` : '');

function MoneyInput({ value, onChange, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; placeholder: string }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="text"
        inputMode="numeric"
        value={value ? value.toLocaleString('es-CO') : ''}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '');
          onChange(digits ? Number(digits) : undefined);
        }}
        placeholder={placeholder}
        className={`${inputClass} max-w-xs`}
      />
      <span className="text-xs text-zinc-500">{money(value)}</span>
    </div>
  );
}

/** Precios, bonos y cotización en el chat. */
export function AiPricingPanel({ draft, onUpdate }: AiPricingPanelProps) {
  const base = draft.quoteBonusBase;
  const max = draft.quoteBonusMax;
  const bonusError = base !== undefined && max !== undefined && max < base;

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Precios y cotizaciones</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Los valores exactos siempre salen del cotizador; aquí defines lo que la IA dice de forma general.
        </p>
      </div>

      <FormField label="Cotización en el chat" htmlFor="quoteMode" hint="Si la IA envía la imagen oficial de la cotización">
        <select
          id="quoteMode"
          value={draft.quoteMode ?? 'off'}
          onChange={(e) => onUpdate('quoteMode', e.target.value as AiConfigDraft['quoteMode'])}
          className={inputClass}
        >
          <option value="off">Desactivada — solo da el precio "desde" y ofrece la llamada</option>
          <option value="on_request">Solo si el cliente pregunta el precio de un terreno</option>
          <option value="proactive">Proactiva — ofrece la cotización al elegir un terreno</option>
        </select>
      </FormField>

      <FormField label='Precio "desde" (de contado)' hint="Lo menciona cuando preguntan en general cuánto valen los terrenos">
        <MoneyInput value={draft.advertisedPrice} onChange={(v) => onUpdate('advertisedPrice', v)} placeholder="129.990.000" />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Bono incluido en la cotización" hint="Se descuenta en toda cotización">
          <MoneyInput value={base} onChange={(v) => onUpdate('quoteBonusBase', v)} placeholder="20.000.000" />
        </FormField>
        <FormField label="Bono máximo del juego" hint="Tope si el cliente dice que ganó un bono">
          <MoneyInput value={max} onChange={(v) => onUpdate('quoteBonusMax', v)} placeholder="50.000.000" />
        </FormField>
      </div>
      {bonusError && (
        <p className="-mt-3 text-xs text-red-400">El bono máximo no puede ser menor que el bono incluido.</p>
      )}

      <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/40 p-4 flex flex-col gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-100">Cómo responde cuando preguntan precios</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Como lo hacen los asesores: precio promedio, lo que puede quedar con los bonos del mes, la separación y un ejemplo de cuotas.
            Actualízalo cada mes; si dejas un campo vacío, la IA no lo menciona.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Precio promedio de referencia" hint="Ej.: los terrenos de 300 m² en promedio">
            <MoneyInput value={draft.priceReference} onChange={(v) => onUpdate('priceReference', v)} placeholder="145.000.000" />
          </FormField>
          <FormField label="Área de referencia (m²)" hint="Tamaño al que corresponde ese promedio">
            <input
              type="text"
              inputMode="numeric"
              value={draft.priceReferenceArea ?? ''}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '');
                onUpdate('priceReferenceArea', digits ? Number(digits) : undefined);
              }}
              placeholder="300"
              className={`${inputClass} max-w-[8rem]`}
            />
          </FormField>
          <FormField label="Con bono puede quedar desde" hint="El precio más bajo que se alcanza con los bonos del mes">
            <MoneyInput value={draft.priceWithBonusFrom} onChange={(v) => onUpdate('priceWithBonusFrom', v)} placeholder="94.000.000" />
          </FormField>
          <FormField label="Bonos del mes desde" hint="Bono mínimo; el máximo es el del juego">
            <MoneyInput value={draft.bonusRangeMin} onChange={(v) => onUpdate('bonusRangeMin', v)} placeholder="5.000.000" />
          </FormField>
          <FormField label="Valor de separación" hint="Con cuánto se separa un terreno">
            <MoneyInput value={draft.separationAmount} onChange={(v) => onUpdate('separationAmount', v)} placeholder="6.990.000" />
          </FormField>
        </div>
        <FormField label="Ejemplo de plan de pagos" hint="La IA lo usa tal cual, como ejemplo (no calcula otras cuotas)">
          <textarea
            rows={2}
            maxLength={300}
            value={draft.paymentPlanExample ?? ''}
            onChange={(e) => onUpdate('paymentPlanExample', e.target.value || undefined)}
            placeholder="A 20 cuotas, por ejemplo: 18 cuotas de 2 millones y 2 cuotas extraordinarias."
            className={inputClass}
          />
        </FormField>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-700/50 bg-zinc-800/60 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-zinc-100">Cotizar aldeas de Sobre Montañas</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Contado, 12, 18 o 24 meses. Apágalo si los precios de Sobre Montañas en el cotizador no están al día.
          </p>
        </div>
        <Switch
          checked={draft.sobreMontanasQuotes === true}
          onChange={(v) => onUpdate('sobreMontanasQuotes', v)}
          label="Cotizar aldeas de Sobre Montañas"
        />
      </div>
    </section>
  );
}
