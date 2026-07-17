import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import {
  listContactFields,
  saveContactFields,
  type ContactField,
  type ContactFieldType,
} from '@/features/leads/services/contactFields.service';

const inputClass = 'h-9 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-violet-500/60';

type ContactFieldDraft = ContactField & {
  clientKey: string;
  optionsText: string;
  idTouched: boolean;
};

function newClientKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function idFromLabel(label: string) {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function toDraftField(field: ContactField | Partial<ContactFieldDraft>, fallbackKey?: string): ContactFieldDraft {
  const draft = field as Partial<ContactFieldDraft>;
  const options = field.options ?? [];
  return {
    clientKey: draft.clientKey || fallbackKey || field.id || newClientKey(),
    id: field.id ?? '',
    label: field.label ?? '',
    type: field.type ?? 'text',
    options,
    optionsText: draft.optionsText ?? options.join(', '),
    idTouched: draft.idTouched ?? !!field.id,
  };
}

export function ContactFieldsPanel({ companyId }: { companyId: string }) {
  const [fields, setFields] = useState<ContactFieldDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    listContactFields(companyId)
      .then((loadedFields) => setFields(loadedFields.map((field) => toDraftField(field))))
      .catch((err) => {
        console.error('[ContactFields] load error:', err);
        setError('No se pudieron cargar los campos.');
      })
      .finally(() => setLoading(false));
  }, [companyId]);

  const addField = () => {
    const base = `campo_${fields.length + 1}`;
    setSaved(false);
    setFields((current) => [...current, toDraftField({
      clientKey: newClientKey(),
      id: base,
      label: '',
      type: 'text',
      options: [],
      optionsText: '',
      idTouched: false,
    })]);
  };

  const patchField = (index: number, patch: Partial<ContactFieldDraft>) => {
    setSaved(false);
    setFields((current) => current.map((field, i) => i === index ? toDraftField({ ...field, ...patch }, field.clientKey) : toDraftField(field)));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const normalized = fields.map(({ clientKey: _clientKey, optionsText, idTouched: _idTouched, ...field }) => ({
        id: field.id || idFromLabel(field.label),
        label: field.label,
        type: field.type,
        options: field.type === 'select'
          ? (optionsText ?? '').split(',').map((item: string) => item.trim()).filter(Boolean)
          : [],
      }));
      const savedFields = await saveContactFields(companyId, normalized);
      setFields(savedFields.map((field) => toDraftField(field)));
      setSaved(true);
    } catch (err) {
      console.error('[ContactFields] save error:', err);
      setError('No se pudieron guardar los campos. Revisa IDs duplicados o caracteres invalidos.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Campos de contactos</h2>
          <p className="mt-1 text-xs text-zinc-500">Define datos extra para importar y editar en la ficha del lead.</p>
        </div>
        <Button size="sm" onClick={addField}><Plus size={14} /> Campo</Button>
      </div>

      {error && <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      <div className="space-y-2">
        {loading ? (
          <p className="text-xs text-zinc-500">Cargando campos...</p>
        ) : fields.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">
            Aun no hay campos personalizados.
          </div>
        ) : fields.map((rawField, index) => {
          const field = toDraftField(rawField, `${index}-${rawField.id ?? ''}`);
          return (
          <div key={field.clientKey} className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 md:grid-cols-[1fr_150px_1fr_auto]">
            <div className="space-y-1">
              <input
                className={`${inputClass} w-full`}
                value={field.label}
                onChange={(event) => {
                  const label = event.target.value;
                  patchField(index, {
                    label,
                    ...(field.idTouched ? {} : { id: idFromLabel(label) || field.id }),
                  });
                }}
                onBlur={() => {
                  if (!field.id.trim()) patchField(index, { id: idFromLabel(field.label) });
                }}
                placeholder="Nombre del campo"
              />
              <input
                className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[11px] text-zinc-500 outline-none focus:border-violet-500/50"
                value={field.id}
                onChange={(event) => patchField(index, { id: event.target.value.replace(/[^a-zA-Z0-9_]/g, ''), idTouched: true })}
                placeholder="id_campo"
              />
            </div>
            <select className={inputClass} value={field.type} onChange={(event) => patchField(index, { type: event.target.value as ContactFieldType })}>
              <option value="text">Texto</option>
              <option value="number">Numero</option>
              <option value="date">Fecha</option>
              <option value="select">Lista</option>
            </select>
            <input
              className={`${inputClass} w-full disabled:opacity-40`}
              disabled={field.type !== 'select'}
              value={field.optionsText}
              onChange={(event) => patchField(index, { optionsText: event.target.value })}
              placeholder="RioClaro, Brisas, Terranova"
            />
            <button
              onClick={() => {
                setSaved(false);
                setFields((current) => current.filter((_, i) => i !== index));
              }}
              title="Eliminar campo"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-800 text-zinc-500 hover:border-red-500/30 hover:text-red-300"
            >
              <Trash2 size={14} />
            </button>
          </div>
        );
        })}
      </div>

      <div className="flex justify-end">
        <div className="flex flex-col items-end gap-2">
          {saved && (
            <p className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              Campos guardados correctamente.
            </p>
          )}
          <Button onClick={save} loading={saving}>
            <Save size={15} /> {saving ? 'Guardando...' : saved ? 'Guardado' : 'Guardar campos'}
          </Button>
        </div>
      </div>
    </div>
  );
}
