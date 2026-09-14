import { useState, type ChangeEvent } from 'react';
import { Button } from '@/shared/components/Button';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useBranding } from '@/providers/BrandingProvider';
import { uploadBrandLogo } from '../services/brandingUpload.service';

const inputClass = 'mt-1.5 h-10 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-500/60';

const PRESETS = [
  '#7c3aed',
  '#d4a017',
  '#0ea5e9',
  '#10b981',
  '#ef4444',
  '#f97316',
];

export function BrandingConfigForm() {
  const { branding, draft, status, error, isDirty, update, save, reset } = useBranding();
  const { companyId } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const busy = status === 'saving' || status === 'loading';
  const logo = draft.logoUrl || '/meraki-logo.png';

  const handleLogoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !companyId) return;

    setUploading(true);
    setUploadPct(0);
    setUploadError(null);

    try {
      const result = await uploadBrandLogo(file, companyId, (progress) => setUploadPct(progress.percent));
      update('logoUrl', result.downloadUrl);
      setUploadPct(100);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'No se pudo subir el logo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Marca de la aplicacion</h3>
          <p className="mt-1 text-xs text-zinc-500">
            Personaliza el nombre, logo y color principal que ven los usuarios del CRM.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
          <img src={logo} alt="" className="h-10 w-10 rounded-full object-cover" />
          <div>
            <p className="text-sm font-semibold text-zinc-100">{draft.appName || branding.appName}</p>
            <p className="text-[10px] text-zinc-500">{draft.tagline || 'Sin subtitulo'}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs font-medium text-zinc-400">
          Nombre de la app
          <input
            value={draft.appName}
            onChange={(event) => update('appName', event.target.value)}
            maxLength={40}
            className={inputClass}
            placeholder="Meraki CRM"
          />
        </label>

        <label className="text-xs font-medium text-zinc-400">
          Subtitulo
          <input
            value={draft.tagline}
            onChange={(event) => update('tagline', event.target.value)}
            maxLength={60}
            className={inputClass}
            placeholder="Conversacional"
          />
        </label>

        <div className="text-xs font-medium text-zinc-400 md:col-span-2">
          Logo
          <div className="mt-1.5 flex flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3 sm:flex-row sm:items-center">
            <img src={logo} alt="" className="h-14 w-14 rounded-full object-cover" />
            <div className="min-w-0 flex-1">
              <input
                value={draft.logoUrl}
                onChange={(event) => update('logoUrl', event.target.value)}
                maxLength={500}
                className={`${inputClass} mt-0`}
                placeholder="/meraki-logo.png"
              />
              {uploading && (
                <div className="mt-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full bg-violet-500 transition-all" style={{ width: `${uploadPct}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-500">Subiendo logo {uploadPct}%</p>
                </div>
              )}
            </div>
            <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-zinc-700 px-3 text-xs font-medium text-zinc-100 transition-colors hover:border-violet-500/40 hover:bg-violet-500/10">
              Cargar imagen
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={handleLogoFile}
                disabled={uploading || busy}
              />
            </label>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-500">PNG, JPG, WebP o SVG. Maximo 2 MB.</p>
        </div>

        <div className="md:col-span-2">
          <label className="text-xs font-medium text-zinc-400">
            Color principal
            <div className="mt-1.5 flex items-center gap-3">
              <input
                type="color"
                value={draft.primaryColor}
                onChange={(event) => update('primaryColor', event.target.value)}
                className="h-10 w-12 rounded-md border border-zinc-700 bg-zinc-800 p-1"
              />
              <input
                value={draft.primaryColor}
                onChange={(event) => update('primaryColor', event.target.value)}
                className={`${inputClass} mt-0 max-w-[150px] font-mono uppercase`}
                placeholder="#7c3aed"
              />
              <div className="flex gap-1.5">
                {PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => update('primaryColor', color)}
                    className="h-7 w-7 rounded-full border border-white/10"
                    style={{ backgroundColor: color }}
                    aria-label={`Usar ${color}`}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </label>
        </div>
      </div>

      {(error || uploadError) && (
        <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {uploadError || error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={save} disabled={!isDirty || busy} loading={status === 'saving'}>
          Guardar marca
        </Button>
        <Button type="button" variant="secondary" onClick={reset} disabled={busy}>
          Restaurar Meraki
        </Button>
      </div>
    </section>
  );
}
