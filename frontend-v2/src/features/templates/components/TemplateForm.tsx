import { useState }        from 'react';
import { useAuth }         from '@/features/auth/hooks/useAuth';
import { Button }          from '@/shared/components/Button';
import { uploadMedia }     from '@/features/inbox/services/media.service';
import type {
  CreateTemplateInput, TemplateVariable, TemplateHeaderType,
  TemplateButton, TemplateButtonType,
} from '../types';

interface TemplateFormProps {
  initial?: Partial<CreateTemplateInput>;
  onSave:   (data: Omit<CreateTemplateInput, 'companyId'>) => Promise<void>;
  onCancel: () => void;
}

const EMPTY: Omit<CreateTemplateInput, 'companyId'> = {
  name: '', displayName: '', category: 'utility',
  language: 'es', body: '', variables: [], status: 'local',
  headerType: 'none', buttons: [],
};

/** Extrae variables {{key}} del body */
function extractVars(body: string): string[] {
  const matches = [...body.matchAll(/\{\{(\w+)\}\}/g)];
  return [...new Set(matches.map((m) => m[1]))];
}

const ACCEPT: Record<string, string> = {
  image:    'image/jpeg,image/png',
  video:    'video/mp4',
  document: 'application/pdf',
};

const BUTTON_LABELS: Record<TemplateButtonType, string> = {
  QUICK_REPLY:  'Respuesta rápida',
  URL:          'Enlace (URL)',
  PHONE_NUMBER: 'Llamar',
  COPY_CODE:    'Copiar código',
};

const inputClass = `
  w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2
  text-sm text-zinc-100 placeholder-zinc-500
  focus:outline-none focus:border-violet-500/50 transition-colors
`;

export function TemplateForm({ initial, onSave, onCancel }: TemplateFormProps) {
  const { companyId } = useAuth();
  const [form,    setForm]    = useState({ ...EMPTY, ...initial });
  const [saving,  setSaving]  = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const detectedKeys = extractVars(form.body);
  const headerType   = form.headerType ?? 'none';
  const buttons      = form.buttons ?? [];

  const syncVariables = (body: string) => {
    const keys = extractVars(body);
    const existing = Object.fromEntries(form.variables.map((v) => [v.key, v.example]));
    const updated: TemplateVariable[] = keys.map((k) => ({ key: k, example: existing[k] ?? '' }));
    setForm((prev) => ({ ...prev, body, variables: updated }));
  };

  const updateExample = (key: string, example: string) => {
    setForm((prev) => ({
      ...prev,
      variables: prev.variables.map((v) => v.key === key ? { ...v, example } : v),
    }));
  };

  // ── Header media upload ─────────────────────────────────────────────────
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadMedia(file, companyId, 'templates');
      setForm((prev) => ({ ...prev, headerMediaUrl: res.downloadUrl, headerMediaFilename: res.fileName }));
    } catch {
      setError('No se pudo subir el archivo.');
    } finally {
      setUploading(false);
    }
  };

  const setHeaderType = (t: TemplateHeaderType) => {
    setForm((prev) => ({ ...prev, headerType: t, header: '', headerMediaUrl: undefined, headerMediaFilename: undefined }));
  };

  // ── Botones ───────────────────────────────────────────────────────────────
  const addButton = () => {
    if (buttons.length >= 3) return;
    setForm((prev) => ({ ...prev, buttons: [...(prev.buttons ?? []), { type: 'QUICK_REPLY', text: '' }] }));
  };
  const updateButton = (i: number, patch: Partial<TemplateButton>) => {
    setForm((prev) => ({
      ...prev,
      buttons: (prev.buttons ?? []).map((b, idx) => idx === i ? { ...b, ...patch } : b),
    }));
  };
  const removeButton = (i: number) => {
    setForm((prev) => ({ ...prev, buttons: (prev.buttons ?? []).filter((_, idx) => idx !== i) }));
  };

  const handleSubmit = async () => {
    // Lo único obligatorio: nombre visible + cuerpo (igual que Meta)
    if (!form.displayName || !form.body) {
      setError('Nombre y cuerpo son obligatorios.');
      return;
    }
    if ((headerType === 'image' || headerType === 'video' || headerType === 'document') && !form.headerMediaUrl) {
      setError('Sube el archivo de muestra para la cabecera.');
      return;
    }

    // Descartar botones vacíos (los que el usuario agregó pero no completó)
    const cleanButtons = buttons.filter((b) => {
      if (b.type === 'COPY_CODE')    return true;
      if (b.type === 'URL')          return !!(b.text?.trim() || b.url?.trim());
      if (b.type === 'PHONE_NUMBER') return !!(b.text?.trim() || b.phoneNumber?.trim());
      return !!b.text?.trim(); // QUICK_REPLY
    });

    // Validar solo los botones que sí tienen contenido (están incompletos)
    for (const b of cleanButtons) {
      if ((b.type === 'URL' || b.type === 'PHONE_NUMBER' || b.type === 'QUICK_REPLY') && !b.text?.trim()) {
        setError('Falta el texto en un botón.'); return;
      }
      if (b.type === 'URL' && !b.url?.trim())          { setError('Falta la URL en un botón de enlace.'); return; }
      if (b.type === 'PHONE_NUMBER' && !b.phoneNumber?.trim()) { setError('Falta el teléfono en un botón de llamada.'); return; }
    }

    // Normalizar cabecera de texto vacía → sin cabecera
    const cleanHeader = headerType === 'text' && !form.header?.trim() ? 'none' : headerType;

    setSaving(true);
    setError(null);
    try {
      await onSave({ ...form, headerType: cleanHeader, buttons: cleanButtons });
    } catch (err) {
      setError((err as { message?: string })?.message || 'Error al guardar la plantilla.');
    } finally {
      setSaving(false);
    }
  };

  const preview = form.body.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = form.variables.find((x) => x.key === k);
    return v?.example ? v.example : `[${k}]`;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Nombre y categoría */}
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400">Nombre para mostrar</label>
          <input
            type="text"
            value={form.displayName}
            onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
            placeholder="Reactivación lead"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-400">Categoría</label>
          <select
            value={form.category}
            onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as CreateTemplateInput['category'] }))}
            className={inputClass}
          >
            <option value="marketing">📣 Marketing</option>
            <option value="utility">🔧 Utilidad</option>
            <option value="authentication">🔐 Autenticación</option>
          </select>
        </div>
      </div>

      {/* Nombre interno */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400">
          Nombre interno <span className="text-zinc-600">(snake_case, sin espacios)</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
          placeholder="reactivacion_lead"
          className={inputClass}
        />
      </div>

      {/* Cabecera */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400">Cabecera <span className="text-zinc-600">(opcional)</span></label>
        <select
          value={headerType}
          onChange={(e) => setHeaderType(e.target.value as TemplateHeaderType)}
          className={inputClass}
        >
          <option value="none">Sin cabecera</option>
          <option value="text">📝 Texto</option>
          <option value="image">🖼️ Imagen</option>
          <option value="video">🎥 Video</option>
          <option value="document">📄 Documento (PDF)</option>
        </select>

        {headerType === 'text' && (
          <input
            type="text"
            value={form.header ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, header: e.target.value }))}
            placeholder="Texto de la cabecera (máx. 60)"
            maxLength={60}
            className={inputClass}
          />
        )}

        {(headerType === 'image' || headerType === 'video' || headerType === 'document') && (
          <div className="flex flex-col gap-2">
            <input
              type="file"
              accept={ACCEPT[headerType]}
              onChange={handleMediaUpload}
              disabled={uploading}
              className="text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-zinc-200 file:text-xs"
            />
            {uploading && <p className="text-[10px] text-amber-400">Subiendo archivo…</p>}
            {form.headerMediaUrl && !uploading && (
              <p className="text-[10px] text-green-400 break-all">✓ Archivo de muestra cargado</p>
            )}
            <p className="text-[10px] text-zinc-600">
              Meta exige un archivo de muestra. {headerType === 'image' ? 'JPG/PNG ≤5MB.' : headerType === 'video' ? 'MP4 ≤16MB.' : 'PDF ≤100MB.'}
            </p>
          </div>
        )}
      </div>

      {/* Cuerpo */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400">
          Cuerpo del mensaje
          <span className="text-zinc-600 font-normal ml-2">Usa {'{{variable}}'} para datos dinámicos</span>
        </label>
        <textarea
          value={form.body}
          onChange={(e) => syncVariables(e.target.value)}
          rows={5}
          placeholder={`Hola {{nombre}}, soy Victoria de Meraki 🏡\n¿Sigues interesado en conocer {{proyecto}}?`}
          className={`${inputClass} resize-y font-mono text-xs leading-relaxed`}
        />
        {detectedKeys.length > 0 && (
          <p className="text-[10px] text-zinc-500">
            Variables detectadas: {detectedKeys.map((k) => `{{${k}}}`).join(', ')}
          </p>
        )}
      </div>

      {/* Ejemplos de variables */}
      {form.variables.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold text-zinc-400">Valores de ejemplo (para preview y aprobación)</p>
          {form.variables.map((v) => (
            <div key={v.key} className="flex items-center gap-3">
              <span className="text-xs text-violet-400 font-mono w-24 shrink-0">{`{{${v.key}}}`}</span>
              <input
                type="text"
                value={v.example}
                onChange={(e) => updateExample(v.key, e.target.value)}
                placeholder={`ej: "Juan Pérez"`}
                className={`${inputClass} flex-1`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400">Pie de página <span className="text-zinc-600">(opcional, máx. 60)</span></label>
        <input
          type="text"
          value={form.footer ?? ''}
          onChange={(e) => setForm((p) => ({ ...p, footer: e.target.value }))}
          placeholder="Equipo Meraki"
          maxLength={60}
          className={inputClass}
        />
      </div>

      {/* Botones */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-zinc-400">Botones <span className="text-zinc-600">(opcional, máx. 3)</span></label>
          <button
            type="button"
            onClick={addButton}
            disabled={buttons.length >= 3}
            className="text-[11px] text-violet-400 hover:text-violet-300 disabled:text-zinc-600 disabled:cursor-not-allowed"
          >
            + Agregar botón
          </button>
        </div>

        {buttons.map((b, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg bg-zinc-800/50 border border-zinc-700/60 p-3">
            <div className="flex items-center gap-2">
              <select
                value={b.type}
                onChange={(e) => updateButton(i, { type: e.target.value as TemplateButtonType })}
                className={`${inputClass} flex-1`}
              >
                {Object.entries(BUTTON_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeButton(i)}
                className="text-zinc-500 hover:text-red-400 text-sm px-1"
                title="Quitar botón"
              >
                🗑
              </button>
            </div>

            {b.type !== 'COPY_CODE' && (
              <input
                type="text"
                value={b.text}
                onChange={(e) => updateButton(i, { text: e.target.value })}
                placeholder="Texto del botón (máx. 25)"
                maxLength={25}
                className={inputClass}
              />
            )}
            {b.type === 'URL' && (
              <input
                type="url"
                value={b.url ?? ''}
                onChange={(e) => updateButton(i, { url: e.target.value })}
                placeholder="https://meraki.com"
                className={inputClass}
              />
            )}
            {b.type === 'PHONE_NUMBER' && (
              <input
                type="tel"
                value={b.phoneNumber ?? ''}
                onChange={(e) => updateButton(i, { phoneNumber: e.target.value })}
                placeholder="+573001112233"
                className={inputClass}
              />
            )}
          </div>
        ))}
      </div>

      {/* Preview */}
      {form.body && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-zinc-400">Preview</p>
          <div className="rounded-xl bg-zinc-800/60 border border-zinc-700 px-4 py-3 flex flex-col gap-2">
            {headerType === 'text' && form.header && (
              <p className="text-sm font-semibold text-zinc-100">{form.header}</p>
            )}
            {(headerType === 'image' || headerType === 'video' || headerType === 'document') && form.headerMediaUrl && (
              <div className="rounded-lg bg-zinc-700/40 px-3 py-2 text-[11px] text-zinc-400">
                {headerType === 'image' ? '🖼️ Imagen' : headerType === 'video' ? '🎥 Video' : '📄 Documento'} de cabecera
              </div>
            )}
            <p className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">{preview}</p>
            {form.footer && <p className="text-[11px] text-zinc-500">{form.footer}</p>}
            {buttons.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {buttons.map((b, i) => (
                  <div key={i} className="text-center text-xs text-violet-300 border-t border-zinc-700 pt-1.5">
                    {b.type === 'COPY_CODE' ? 'Copiar código' : b.text || BUTTON_LABELS[b.type]}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Button onClick={handleSubmit} loading={saving} disabled={saving || uploading}>
          Guardar plantilla
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
