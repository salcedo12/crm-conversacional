import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { Check, ChevronLeft, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import {
  createLeadList,
  importLeadRows,
  type ImportLeadRow,
  type ImportSummary,
} from '../services/leadLists.service';
import { listContactFields, type ContactField } from '../services/contactFields.service';

interface ImportContactsModalProps {
  companyId: string;
  existingTags: string[];
  onClose: () => void;
  onComplete: (listId: string) => void;
}

type CsvRow = Record<string, string>;
type FieldKey = 'name' | 'phone' | 'email' | 'company';

const STEPS = ['Archivo', 'Asignar', 'Verificar', 'Resultado'];
const FIELD_LABELS: Record<FieldKey, string> = {
  name: 'Nombre', phone: 'Teléfono', email: 'Correo', company: 'Empresa',
};

function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function detectColumn(headers: string[], aliases: string[]): string {
  return headers.find((header) => aliases.includes(normalizeHeader(header))) ?? '';
}

export function ImportContactsModal({ companyId, existingTags, onClose, onComplete }: ImportContactsModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({ name: '', phone: '', email: '', company: '' });
  const [customFields, setCustomFields] = useState<ContactField[]>([]);
  const [customMapping, setCustomMapping] = useState<Record<string, string>>({});
  const [listName, setListName] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [createdListId, setCreatedListId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tags = useMemo(() => tagInput.split(',').map((tag) => tag.trim()).filter(Boolean), [tagInput]);

  useEffect(() => {
    listContactFields(companyId)
      .then((fields) => {
        setCustomFields(fields);
        setCustomMapping(Object.fromEntries(fields.map((field) => [field.id, ''])));
      })
      .catch((err) => console.error('[LeadImport] contact fields error:', err));
  }, [companyId]);

  const mappedRows = useMemo<ImportLeadRow[]>(() => {
    const unique = new Map<string, ImportLeadRow>();
    for (const row of rows) {
      const metadata = Object.fromEntries(
        customFields
          .map((field) => [field.id, customMapping[field.id] ? String(row[customMapping[field.id]] ?? '').trim() : ''])
          .filter(([, value]) => value)
      ) as Record<string, string>;
      const mapped = {
        name: mapping.name ? String(row[mapping.name] ?? '').trim() : '',
        phone: mapping.phone ? String(row[mapping.phone] ?? '').trim() : '',
        email: mapping.email ? String(row[mapping.email] ?? '').trim() : '',
        company: mapping.company ? String(row[mapping.company] ?? '').trim() : '',
        metadata,
      };
      const phoneKey = mapped.phone.replace(/\D/g, '');
      if (phoneKey) unique.set(phoneKey, mapped);
    }
    return [...unique.values()];
  }, [rows, mapping, customFields, customMapping]);

  const loadFile = (file?: File) => {
    if (!file) return;
    setError(null);
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        const parsedHeaders = result.meta.fields?.filter(Boolean) ?? [];
        if (!parsedHeaders.length || !result.data.length) {
          setError('El archivo no contiene encabezados o filas válidas.');
          return;
        }
        const nextMapping = {
          name: detectColumn(parsedHeaders, ['nombre', 'name', 'nombrecliente', 'contacto', 'cliente']),
          phone: detectColumn(parsedHeaders, ['telefono', 'phone', 'celular', 'movil', 'whatsapp', 'numero']),
          email: detectColumn(parsedHeaders, ['email', 'correo', 'correoelectronico']),
          company: detectColumn(parsedHeaders, ['empresa', 'company', 'organizacion']),
        };
        setFileName(file.name);
        setListName(file.name.replace(/\.csv$/i, '').slice(0, 60));
        setRows(result.data.slice(0, 5000));
        setHeaders(parsedHeaders);
        setMapping(nextMapping);
        setStep(1);
      },
      error: () => setError('No se pudo leer el archivo CSV.'),
    });
  };

  const downloadSample = () => {
    const blob = new Blob([
      'Nombre,Telefono,Correo,Empresa\nAna Perez,+573001112233,ana@ejemplo.com,Empresa Demo\n',
    ], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'plantilla_contactos.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const startImport = async () => {
    if (!listName.trim() || !consent || !mappedRows.length) return;
    setBusy(true);
    setError(null);
    try {
      const listId = await createLeadList(companyId, listName.trim(), 'import', undefined, fileName, rows.length);
      setCreatedListId(listId);
      const result = await importLeadRows(companyId, listId, mappedRows, tags, (completed, total) => {
        setProgress(Math.round((completed / total) * 100));
      });
      setSummary(result);
      setStep(3);
    } catch (importError) {
      console.error('[LeadImport]', importError);
      setError(importError instanceof Error ? importError.message.replace(/^FirebaseError:\s*/, '') : 'No se pudo completar la importación.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden border border-zinc-800 bg-zinc-900 shadow-2xl sm:rounded-lg" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Importar contactos</h2>
            <p className="mt-0.5 text-xs text-zinc-500">Carga un CSV y crea una lista con los contactos importados.</p>
          </div>
          <button onClick={onClose} title="Cerrar" className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><X size={17} /></button>
        </header>

        <div className="border-b border-zinc-800 px-5 py-3">
          <div className="grid grid-cols-4 gap-2">
            {STEPS.map((label, index) => (
              <div key={label} className="flex items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${index < step ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : index === step ? 'border-violet-500 bg-violet-600 text-white' : 'border-zinc-700 text-zinc-600'}`}>
                  {index < step ? <Check size={12} /> : index + 1}
                </span>
                <span className={`hidden text-[11px] sm:block ${index === step ? 'text-zinc-200' : 'text-zinc-600'}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === 0 && (
            <div>
              <button
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); loadFile(event.dataTransfer.files[0]); }}
                className="flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-zinc-700 bg-zinc-950/40 text-center hover:border-violet-500/60 hover:bg-violet-500/5"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-800 text-zinc-300"><Upload size={20} /></span>
                <span className="text-sm font-medium text-zinc-200">Selecciona o arrastra un archivo CSV</span>
                <span className="text-xs text-zinc-600">Hasta 5.000 filas por importación</span>
              </button>
              <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => loadFile(event.target.files?.[0])} />
              <button onClick={downloadSample} className="mx-auto mt-4 flex items-center gap-2 text-xs text-zinc-500 hover:text-violet-300"><Download size={13} /> Descargar CSV de ejemplo</button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
                <FileSpreadsheet size={20} className="text-emerald-400" />
                <div><p className="text-sm text-zinc-200">{fileName}</p><p className="text-[11px] text-zinc-500">{rows.length} filas detectadas</p></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => (
                  <label key={field} className="text-xs text-zinc-400">
                    {FIELD_LABELS[field]} {field === 'phone' && <span className="text-red-400">*</span>}
                    <select value={mapping[field]} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))} className="mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-200 outline-none focus:border-violet-500/60">
                      <option value="">No importar</option>
                      {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {customFields.length > 0 && (
                <div className="rounded-md border border-zinc-800 bg-zinc-950/30 p-3">
                  <p className="mb-3 text-xs font-medium text-zinc-300">Campos personalizados</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {customFields.map((field) => (
                      <label key={field.id} className="text-xs text-zinc-400">
                        {field.label}
                        <select
                          value={customMapping[field.id] ?? ''}
                          onChange={(event) => setCustomMapping((current) => ({ ...current, [field.id]: event.target.value }))}
                          className="mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-200 outline-none focus:border-violet-500/60"
                        >
                          <option value="">No importar</option>
                          {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="overflow-x-auto rounded-md border border-zinc-800">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-zinc-950/60 text-zinc-500"><tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Teléfono</th><th className="px-3 py-2">Correo</th><th className="px-3 py-2">Empresa</th></tr></thead>
                  <tbody>{mappedRows.slice(0, 3).map((row, index) => <tr key={index} className="border-t border-zinc-800 text-zinc-300"><td className="px-3 py-2">{row.name || '—'}</td><td className="px-3 py-2">{row.phone}</td><td className="px-3 py-2">{row.email || '—'}</td><td className="px-3 py-2">{row.company || '—'}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs text-zinc-400">Nombre de la lista<input value={listName} onChange={(event) => setListName(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60" /></label>
                <label className="text-xs text-zinc-400">Etiquetas opcionales<input value={tagInput} onChange={(event) => setTagInput(event.target.value)} list="import-tag-options" placeholder="webinar, campaña junio" className="mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60" /></label>
                <datalist id="import-tag-options">{existingTags.map((tag) => <option key={tag} value={tag} />)}</datalist>
              </div>
              <div className="grid grid-cols-3 border-y border-zinc-800 py-4 text-center">
                <div><p className="text-xl font-semibold text-zinc-100">{rows.length}</p><p className="text-[11px] text-zinc-500">Filas leídas</p></div>
                <div className="border-x border-zinc-800"><p className="text-xl font-semibold text-emerald-400">{mappedRows.length}</p><p className="text-[11px] text-zinc-500">Con teléfono</p></div>
                <div><p className="text-xl font-semibold text-zinc-100">{tags.length}</p><p className="text-[11px] text-zinc-500">Etiquetas</p></div>
              </div>
              <label className="flex items-start gap-3 text-xs leading-5 text-zinc-400">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 accent-violet-500" />
                Confirmo que estos contactos autorizaron recibir comunicaciones y que la información puede almacenarse en el CRM.
              </label>
              {busy && <div><div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-violet-500 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-center text-xs text-zinc-500">Importando {progress}%</p></div>}
            </div>
          )}

          {step === 3 && summary && (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400"><Check size={28} /></span>
              <h3 className="mt-4 text-lg font-semibold text-zinc-100">Importación completada</h3>
              <p className="mt-1 text-sm text-zinc-500">La lista “{listName}” ya está disponible en Leads.</p>
              <div className="mt-6 grid w-full max-w-md grid-cols-3 border-y border-zinc-800 py-4">
                <ResultCount value={summary.created} label="Creados" />
                <ResultCount value={summary.updated} label="Actualizados" border />
                <ResultCount value={summary.invalid} label="Omitidos" />
              </div>
            </div>
          )}

          {error && <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        <footer className="flex items-center justify-between border-t border-zinc-800 px-5 py-4">
          {step > 0 && step < 3 ? <Button variant="ghost" size="sm" onClick={() => setStep((current) => current - 1)} disabled={busy}><ChevronLeft size={14} /> Atrás</Button> : <span />}
          {step === 1 && <Button size="sm" onClick={() => setStep(2)} disabled={!mapping.phone || !mappedRows.length}>Continuar</Button>}
          {step === 2 && <Button size="sm" onClick={startImport} loading={busy} disabled={!listName.trim() || !consent || !mappedRows.length}>Iniciar importación</Button>}
          {step === 3 && <Button size="sm" onClick={() => onComplete(createdListId)}>Ver lista</Button>}
        </footer>
      </div>
    </div>
  );
}

function ResultCount({ value, label, border = false }: { value: number; label: string; border?: boolean }) {
  return <div className={border ? 'border-x border-zinc-800' : ''}><p className="text-xl font-semibold text-zinc-100">{value}</p><p className="text-[11px] text-zinc-500">{label}</p></div>;
}
