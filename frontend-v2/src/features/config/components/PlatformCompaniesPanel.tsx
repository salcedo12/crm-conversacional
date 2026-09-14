import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/shared/components/Button';
import {
  listPlatformCompanies,
  saveChannelRoute,
  savePlatformCompany,
  type ChannelProvider,
  type CompanyEnvironment,
  type PlatformCompany,
} from '@/features/platform/services/platformCompanies.service';

const PROVIDERS: { value: ChannelProvider; label: string; hint: string }[] = [
  { value: 'ycloud', label: 'YCloud WhatsApp', hint: 'Numero de negocio o phoneId' },
  { value: 'dapta', label: 'Dapta llamadas IA', hint: 'Agent ID, flow ID o identificador del payload' },
  { value: 'twilio', label: 'Twilio WhatsApp', hint: 'Numero de negocio' },
  { value: 'messenger', label: 'Messenger', hint: 'Page ID receptor' },
  { value: 'instagram', label: 'Instagram', hint: 'IG business/Page ID receptor' },
];

const inputClass = 'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500';
const labelClass = 'mb-1 block text-xs font-medium text-zinc-400';

function defaultCompanyDraft() {
  return {
    companyId: '',
    name: '',
    environment: 'production' as CompanyEnvironment,
    active: true,
    smartHomeEnabled: false,
  };
}

function defaultRouteDraft(companyId = '') {
  return {
    companyId,
    provider: 'ycloud' as ChannelProvider,
    identifier: '',
    label: '',
    active: true,
  };
}

export function PlatformCompaniesPanel() {
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [companyDraft, setCompanyDraft] = useState(defaultCompanyDraft);
  const [routeDraft, setRouteDraft] = useState(defaultRouteDraft);
  const [loading, setLoading] = useState(true);
  const [savingCompany, setSavingCompany] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedId) ?? companies[0],
    [companies, selectedId]
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const rows = await listPlatformCompanies();
      setCompanies(rows);
      const selected = selectedId || rows.find((company) => company.id !== 'empresa_demo')?.id || rows[0]?.id || '';
      setSelectedId(selected);
      setRouteDraft((draft) => ({ ...draft, companyId: selected || draft.companyId }));
    } catch (err) {
      console.error('[PlatformCompaniesPanel] load error:', err);
      setError('No se pudieron cargar las empresas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedCompany) {
      setRouteDraft((draft) => ({ ...draft, companyId: selectedCompany.id }));
    }
  }, [selectedCompany?.id]);

  async function handleSaveCompany(event: FormEvent) {
    event.preventDefault();
    setSavingCompany(true);
    setError(null);
    try {
      const companyId = await savePlatformCompany(companyDraft);
      setCompanyDraft(defaultCompanyDraft());
      setSelectedId(companyId);
      await load();
    } catch (err) {
      console.error('[PlatformCompaniesPanel] save company error:', err);
      setError('No se pudo guardar la empresa. Revisa el ID y los datos.');
    } finally {
      setSavingCompany(false);
    }
  }

  async function handleSaveRoute(event: FormEvent) {
    event.preventDefault();
    setSavingRoute(true);
    setError(null);
    try {
      await saveChannelRoute(routeDraft);
      setRouteDraft(defaultRouteDraft(routeDraft.companyId));
      await load();
    } catch (err) {
      console.error('[PlatformCompaniesPanel] save route error:', err);
      setError('No se pudo guardar la ruta del canal.');
    } finally {
      setSavingRoute(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-100">Empresas y conexiones</h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          empresa_demo queda como sandbox. Registra aqui los canales de cada empresa real para que los webhooks creen leads en la empresa correcta.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Empresas</h3>
            <Button type="button" size="sm" variant="ghost" onClick={load} disabled={loading}>
              Actualizar
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-800">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">Cargando empresas...</div>
            ) : companies.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">No hay empresas registradas.</div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {companies.map((company) => (
                  <button
                    key={company.id}
                    type="button"
                    onClick={() => setSelectedId(company.id)}
                    className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors ${
                      selectedCompany?.id === company.id ? 'bg-violet-500/10' : 'hover:bg-zinc-900'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-100">{company.name}</span>
                      <span className="block truncate text-xs text-zinc-500">{company.id}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        company.environment === 'demo' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'
                      }`}>
                        {company.environment === 'demo' ? 'Demo' : 'Produccion'}
                      </span>
                      {company.smartHomeEnabled && (
                        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
                          SmartHome
                        </span>
                      )}
                      <span className={`h-2 w-2 rounded-full ${company.active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-5">
          <form onSubmit={handleSaveCompany} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">Nueva empresa</h3>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>ID interno</label>
                <input
                  className={inputClass}
                  value={companyDraft.companyId}
                  onChange={(event) => setCompanyDraft((draft) => ({ ...draft, companyId: event.target.value.toLowerCase().replace(/\s+/g, '_') }))}
                  placeholder="grupo_meraki_real"
                />
              </div>
              <div>
                <label className={labelClass}>Nombre</label>
                <input
                  className={inputClass}
                  value={companyDraft.name}
                  onChange={(event) => setCompanyDraft((draft) => ({ ...draft, name: event.target.value }))}
                  placeholder="Grupo Constructor Meraki"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Entorno</label>
                  <select
                    className={inputClass}
                    value={companyDraft.environment}
                    onChange={(event) => setCompanyDraft((draft) => ({ ...draft, environment: event.target.value as CompanyEnvironment }))}
                  >
                    <option value="production">Produccion</option>
                    <option value="demo">Demo</option>
                  </select>
                </div>
                <label className="flex items-end gap-2 pb-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={companyDraft.active}
                    onChange={(event) => setCompanyDraft((draft) => ({ ...draft, active: event.target.checked }))}
                  />
                  Activa
                </label>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={companyDraft.smartHomeEnabled}
                  onChange={(event) => setCompanyDraft((draft) => ({ ...draft, smartHomeEnabled: event.target.checked }))}
                />
                Sincronizar primer contacto con SmartHome
              </label>
              <Button type="submit" loading={savingCompany} disabled={!companyDraft.companyId || !companyDraft.name}>
                Guardar empresa
              </Button>
            </div>
          </form>

          <form onSubmit={handleSaveRoute} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-400">Ruta de canal</h3>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Empresa destino</label>
                <select
                  className={inputClass}
                  value={routeDraft.companyId}
                  onChange={(event) => setRouteDraft((draft) => ({ ...draft, companyId: event.target.value }))}
                >
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Proveedor</label>
                <select
                  className={inputClass}
                  value={routeDraft.provider}
                  onChange={(event) => setRouteDraft((draft) => ({ ...draft, provider: event.target.value as ChannelProvider }))}
                >
                  {PROVIDERS.map((provider) => (
                    <option key={provider.value} value={provider.value}>{provider.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Identificador</label>
                <input
                  className={inputClass}
                  value={routeDraft.identifier}
                  onChange={(event) => setRouteDraft((draft) => ({ ...draft, identifier: event.target.value }))}
                  placeholder={PROVIDERS.find((provider) => provider.value === routeDraft.provider)?.hint}
                />
              </div>
              <div>
                <label className={labelClass}>Etiqueta</label>
                <input
                  className={inputClass}
                  value={routeDraft.label}
                  onChange={(event) => setRouteDraft((draft) => ({ ...draft, label: event.target.value }))}
                  placeholder="Linea comercial principal"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={routeDraft.active}
                  onChange={(event) => setRouteDraft((draft) => ({ ...draft, active: event.target.checked }))}
                />
                Ruta activa
              </label>
              <Button type="submit" loading={savingRoute} disabled={!routeDraft.companyId || !routeDraft.identifier}>
                Guardar ruta
              </Button>
            </div>
          </form>
        </section>
      </div>

      {selectedCompany && (
        <section className="rounded-lg border border-zinc-800">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-100">Canales de {selectedCompany.name}</h3>
          </div>
          <div className="divide-y divide-zinc-800">
            {selectedCompany.channelRoutes.length === 0 ? (
              <p className="px-4 py-5 text-sm text-zinc-500">Esta empresa aun no tiene rutas de canal.</p>
            ) : selectedCompany.channelRoutes.map((route) => (
              <div key={route.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[160px_1fr_120px]">
                <span className="font-medium text-zinc-200">{PROVIDERS.find((provider) => provider.value === route.provider)?.label ?? route.provider}</span>
                <span className="min-w-0 truncate text-zinc-400">
                  {route.identifier}{route.label ? ` - ${route.label}` : ''}
                </span>
                <span className={route.active ? 'text-emerald-400' : 'text-zinc-500'}>{route.active ? 'Activa' : 'Inactiva'}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
