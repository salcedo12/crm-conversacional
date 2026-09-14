import { useMemo, useState } from 'react';
import {
  FileText,
  Search,
  CheckCircle2,
} from 'lucide-react';
import {
  SalesCommissionItem,
  SalesCommissionReportResponse,
} from '../services/reports.service';

interface SalesCommissionPanelProps {
  data?: SalesCommissionReportResponse | { sales?: SalesCommissionItem[]; items?: SalesCommissionItem[] } | null;
  salesData?: SalesCommissionReportResponse | null;
  monthLabel?: string;
  onOpenModal?: (sale: SalesCommissionItem) => void;
}

export function SalesCommissionPanel({
  data,
  salesData,
  monthLabel = 'Periodo',
  onOpenModal,
}: SalesCommissionPanelProps) {
  const [q, setQ] = useState('');

  const reportObj = salesData || (data as SalesCommissionReportResponse | null);
  const rawSales = (data as any)?.sales || (data as any)?.items || salesData?.items || salesData?.sales || [];
  const salesList: SalesCommissionItem[] = Array.isArray(rawSales) ? rawSales : [];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return salesList;
    return salesList.filter((it) =>
      `${it.clientName || ''} ${it.documentNumber || ''} ${it.module || ''} ${it.project || ''} ${it.advisorName || ''} ${it.agentCr || ''} ${it.agentLinea || ''} ${it.agentCierre || ''}`
        .toLowerCase()
        .includes(needle)
    );
  }, [salesList, q]);

  const docsCount = salesList.filter((i) => i.documentGenerated).length;
  const totalSales = reportObj?.totalSales ?? salesList.length;
  const totalVolume = reportObj?.totalVolume ?? salesList.reduce((s, it) => s + (it.totalValue || 0), 0);
  const totalCommissions = reportObj?.totalCommissions ?? salesList.reduce((s, it) => s + (it.totalCommissionValue || 0), 0);

  return (
    <div className="space-y-5">
      {/* Subtítulo */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
        <p>
          <span className="font-semibold text-zinc-200">{totalSales} ventas registradas</span> en{' '}
          <span className="text-emerald-400 font-medium">{monthLabel}</span> · cálculo automático de comisiones y plantillas Word oficiales
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-[10px] font-semibold uppercase text-zinc-500">VENTAS CERRADAS</p>
          <p className="mt-1 text-xl font-bold text-emerald-400">{totalSales}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-[10px] font-semibold uppercase text-zinc-500">VOLUMEN DE VENTAS</p>
          <p className="mt-1 text-xl font-bold text-zinc-100">$ {totalVolume.toLocaleString('es-CO')}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-[10px] font-semibold uppercase text-zinc-500">COMISIONES TOTALES</p>
          <p className="mt-1 text-xl font-bold text-amber-400">$ {totalCommissions.toLocaleString('es-CO')}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="text-[10px] font-semibold uppercase text-zinc-500">DOCUMENTOS WORD</p>
          <p className="mt-1 text-xl font-bold text-sky-300">
            {docsCount} de {totalSales} ({totalSales > 0 ? Math.round((docsCount / totalSales) * 100) : 0}%)
          </p>
        </div>
      </div>

      {/* Escala por Asesor de Cierre */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          Escala por asesor de cierre ({monthLabel})
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Ventas acumuladas por asesor en el mes y porcentaje de comisión escalonado aplicado.
        </p>

        {salesList.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-600">Sin ventas en este periodo.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(
              salesList.reduce((acc, it) => {
                const adv = it.advisorName || 'Sin asesor';
                if (!acc[adv]) {
                  acc[adv] = { count: 0, volume: 0, commission: 0, rate: (it.captacionRate || 0.01) + (it.lineaRate || 0.005) + (it.cierreRate || 0.005) };
                }
                acc[adv].count += 1;
                acc[adv].volume += it.totalValue || 0;
                acc[adv].commission += it.totalCommissionValue || 0;
                return acc;
              }, {} as Record<string, { count: number; volume: number; commission: number; rate: number }>)
            ).map(([advName, stats]) => (
              <div key={advName} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-zinc-100">{advName}</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      {stats.count} {stats.count === 1 ? 'unidad vendida' : 'unidades vendidas'}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                    {(stats.rate * 100).toFixed(1)}% asesor
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-zinc-800/80 pt-2 text-xs">
                  <div>
                    <span className="text-[9px] uppercase text-zinc-500">Volumen</span>
                    <p className="font-semibold text-zinc-200">$ {stats.volume.toLocaleString('es-CO')}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] uppercase text-amber-400/80">Comisión Asesor + Dir</span>
                    <p className="font-bold text-amber-300">$ {stats.commission.toLocaleString('es-CO')}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tabla */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <FileText size={16} className="text-emerald-400" /> Detalle de Ventas y Comisiones ({monthLabel})
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Consulta cada cierre de venta, comisiones calculadas y genera o descarga el documento Word oficial.
            </p>
          </div>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar cliente, cédula, lote..."
              className="w-64 rounded-lg border border-zinc-800 bg-zinc-950/60 py-1.5 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-8 text-center">
            <FileText size={24} className="mx-auto text-zinc-700" />
            <p className="mt-2 text-sm text-zinc-400">No se encontraron ventas para {monthLabel}</p>
            <p className="mt-1 text-xs text-zinc-600">Selecciona otro mes o verifica los cierres en SmartHome.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-[10px] uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2.5">Cliente / Documento</th>
                  <th className="px-3 py-2.5">Proyecto / Lote</th>
                  <th className="px-3 py-2.5">Valores Venta</th>
                  <th className="px-3 py-2.5">Asesor Comercial</th>
                  <th className="px-3 py-2.5">Comisión</th>
                  <th className="px-3 py-2.5 text-center">Documento Word</th>
                  <th className="px-3 py-2.5 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 bg-zinc-950/30">
                {filtered.map((item) => (
                  <tr key={item.saleId} className="hover:bg-zinc-900/60 transition-colors">
                    <td className="px-3 py-2.5 text-zinc-200">
                      <p className="font-bold text-zinc-100 text-sm">{item.clientName}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {item.documentNumber ? (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] font-mono font-semibold text-zinc-200">
                            {item.documentNumber}
                          </span>
                        ) : (
                          <span className="text-zinc-600 italic text-[11px]">(Sin cédula)</span>
                        )}
                        <span className="text-[10px] text-zinc-500">· {item.stage}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-zinc-100">
                      <p className="font-semibold text-emerald-300">{item.module || item.lotNumber}</p>
                      <p className="text-[10px] text-zinc-400 truncate max-w-[200px]">{item.project}</p>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">
                      <p className="font-semibold text-zinc-100">$ {item.totalValue?.toLocaleString('es-CO') ?? 0}</p>
                      <p className="text-[10px] text-zinc-500">Separación: $ {item.deposit?.toLocaleString('es-CO') ?? 0}</p>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">
                      <p className="font-medium text-zinc-200">{item.advisorName}</p>
                      <p className="text-[10px] text-amber-400/80 font-mono">
                        {item.advisorMonthlySalesCount ?? 1} venta{(item.advisorMonthlySalesCount ?? 1) > 1 ? 's' : ''} este mes
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-zinc-300">
                      <p className="font-semibold text-amber-300">$ {item.totalCommissionValue?.toLocaleString('es-CO') ?? 0}</p>
                      <p className="text-[10px] text-zinc-500">
                        CR {((item.captacionRate || 0.01) * 100).toFixed(1)}% · L {((item.lineaRate || 0.005) * 100).toFixed(2)}% · C {((item.cierreRate || 0.005) * 100).toFixed(2)}% · Dir 0.5%
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {item.documentGenerated ? (
                        <div className="inline-flex flex-col items-center">
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            <CheckCircle2 size={11} className="text-emerald-400" /> Agregado
                          </span>
                          <span className="mt-0.5 text-[9px] text-zinc-500">{item.documentGeneratedDateStr}</span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-500">
                          Sin generar
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {onOpenModal && (
                        <button
                          onClick={() => onOpenModal(item)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            item.documentGenerated
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                              : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-700'
                          }`}
                        >
                          <FileText size={13} /> {item.documentGenerated ? 'Ver Reporte' : 'Generar Word'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
