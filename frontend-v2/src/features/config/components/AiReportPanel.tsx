import { useEffect, useMemo, useState } from 'react';
import { fetchAiReport, type AiReport, type AiReportDay } from '../services/aiConfig.service';

interface AiReportPanelProps {
  companyId: string;
}

const PERIODS = [
  { days: 1, label: 'Hoy' },
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
] as const;

const FICHA_LABELS: Record<string, string> = {
  cita: 'Citas agendadas',
  pidio_asesor: 'Pidieron asesor',
  servicio_cliente: 'Servicio al cliente',
  objecion_presupuesto: 'Objeción de precio',
  desistimiento: 'No interesados',
  comprador: 'Compradores detectados',
};

// Precio por millón de tokens (USD). Editable: depende del modelo y del plan de OpenAI.
const PRICE_KEY = 'meraki.aiReport.prices';
function loadPrices(): { entrada: number; salida: number } {
  try {
    const raw = localStorage.getItem(PRICE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* sin almacenamiento */ }
  return { entrada: 0, salida: 0 };
}

const num = (n: number) => n.toLocaleString('es-CO');
const shortDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
};

function sum(days: AiReportDay[], pick: (d: AiReportDay) => number) {
  return days.reduce((acc, d) => acc + pick(d), 0);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/60 px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-100 tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Tablero de la IA: qué atendió, cuánto cotizó y agendó, cuánto pasó a asesores y cuánto consumió. */
export function AiReportPanel({ companyId }: AiReportPanelProps) {
  const [days, setDays] = useState<number>(7);
  const [report, setReport] = useState<AiReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [prices, setPrices] = useState(loadPrices);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchAiReport(companyId, days)
      .then((r) => { if (alive) setReport(r); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'No se pudo cargar el tablero.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [companyId, days]);

  const savePrices = (next: { entrada: number; salida: number }) => {
    setPrices(next);
    try { localStorage.setItem(PRICE_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  };

  const totals = useMemo(() => {
    const list = report?.days ?? [];
    const fichas: Record<string, number> = {};
    list.forEach((d) => Object.entries(d.fichas ?? {}).forEach(([k, v]) => { fichas[k] = (fichas[k] ?? 0) + v; }));
    const entrada = sum(list, (d) => d.entrada);
    const salida = sum(list, (d) => d.salida);
    return {
      respuestas: sum(list, (d) => d.respuestas),
      cotizaciones: sum(list, (d) => d.cotizaciones),
      traspasos: sum(list, (d) => d.traspasos),
      fallos: sum(list, (d) => d.fallos),
      fichas,
      entrada,
      salida,
      costo: (entrada / 1e6) * (prices.entrada || 0) + (salida / 1e6) * (prices.salida || 0),
    };
  }, [report, prices]);

  const chats = report?.chatsPeriodo ?? 0;
  const citas = totals.fichas.cita ?? 0;

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Tablero de la IA</h3>
          <p className="mt-1 text-xs text-zinc-500">Lo que atendió el asistente, día por día (hora de Colombia).</p>
        </div>
        <div className="flex rounded-lg border border-zinc-700 p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setDays(p.days)}
              className={`rounded-md px-3 py-1 text-xs transition-colors ${
                days === p.days ? 'bg-violet-500/20 text-violet-200' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : loading && !report ? (
        <p className="text-xs text-zinc-500">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Chats atendidos" value={num(chats)} hint={`${num(totals.respuestas)} respuestas`} />
            <Stat
              label="Cotizaciones"
              value={num(totals.cotizaciones)}
              hint={chats ? `${Math.round((totals.cotizaciones / chats) * 100)}% de los chats` : undefined}
            />
            <Stat label="Citas agendadas" value={num(citas)} hint={chats ? `${Math.round((citas / chats) * 100)}% de los chats` : undefined} />
            <Stat label="Pasados a asesor" value={num(totals.traspasos + (totals.fallos ?? 0))} hint={totals.fallos ? `${num(totals.fallos)} por error técnico` : 'pidieron hablar con un asesor'} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/60 px-4 py-3">
              <p className="text-xs font-medium text-zinc-300">Fichas que llenó la IA</p>
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {Object.entries(FICHA_LABELS).map(([key, label]) => (
                  <li key={key} className="flex justify-between text-zinc-400">
                    <span>{label}</span>
                    <span className="tabular-nums text-zinc-200">{num(totals.fichas[key] ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/60 px-4 py-3">
              <p className="text-xs font-medium text-zinc-300">Consumo de OpenAI</p>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-zinc-400">
                <li className="flex justify-between"><span>Tokens de entrada</span><span className="tabular-nums text-zinc-200">{num(totals.entrada)}</span></li>
                <li className="flex justify-between"><span>Tokens de salida</span><span className="tabular-nums text-zinc-200">{num(totals.salida)}</span></li>
                <li className="flex justify-between">
                  <span>Promedio por chat</span>
                  <span className="tabular-nums text-zinc-200">{chats ? num(Math.round((totals.entrada + totals.salida) / chats)) : '—'}</span>
                </li>
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span>USD por millón:</span>
                <label className="flex items-center gap-1">entrada
                  <input
                    type="number" min={0} step="0.01" value={prices.entrada || ''}
                    onChange={(e) => savePrices({ ...prices, entrada: Number(e.target.value) || 0 })}
                    className="w-16 rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-zinc-200"
                  />
                </label>
                <label className="flex items-center gap-1">salida
                  <input
                    type="number" min={0} step="0.01" value={prices.salida || ''}
                    onChange={(e) => savePrices({ ...prices, salida: Number(e.target.value) || 0 })}
                    className="w-16 rounded bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 text-zinc-200"
                  />
                </label>
                {(prices.entrada > 0 || prices.salida > 0) && (
                  <span className="text-zinc-300">≈ US$ {totals.costo.toFixed(2)}</span>
                )}
              </div>
            </div>
          </div>

          {(report?.days.length ?? 0) > 1 && (
            <div className="overflow-x-auto rounded-xl border border-zinc-700/50">
              <table className="w-full text-xs">
                <thead className="bg-zinc-800/80 text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Día</th>
                    <th className="px-3 py-2 text-right font-medium">Chats</th>
                    <th className="px-3 py-2 text-right font-medium">Respuestas</th>
                    <th className="px-3 py-2 text-right font-medium">Cotizaciones</th>
                    <th className="px-3 py-2 text-right font-medium">Citas</th>
                    <th className="px-3 py-2 text-right font-medium">A asesor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-300">
                  {report!.days.map((d) => (
                    <tr key={d.day}>
                      <td className="px-3 py-1.5 capitalize">{shortDay(d.day)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{num(d.chats)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{num(d.respuestas)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{num(d.cotizaciones)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{num(d.fichas?.cita ?? 0)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{num(d.traspasos + d.fallos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report && report.days.length === 0 && (
            <p className="text-xs text-zinc-500">Todavía no hay actividad de la IA en este periodo. Los datos se empiezan a registrar desde esta versión.</p>
          )}
        </>
      )}
    </section>
  );
}
