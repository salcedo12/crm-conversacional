import { useEffect, useCallback } from 'react';
import { Button }  from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Spinner';
import { useWhatsappConnection } from '../hooks/useWhatsappConnection';

// Declaración mínima del FB SDK para TypeScript
declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (opts: Record<string, unknown>) => void;
      login: (
        callback: (response: {
          authResponse?: { code?: string; accessToken?: string };
          status: string;
        }) => void,
        opts?: Record<string, unknown>
      ) => void;
    };
  }
}

const META_APP_ID         = import.meta.env.VITE_META_APP_ID as string;
const EMBEDDED_CONFIG_ID  = import.meta.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID as string;

interface WhatsappConnectionPanelProps {
  companyId: string;
}

export function WhatsappConnectionPanel({ companyId }: WhatsappConnectionPanelProps) {
  const { connection, status, error, connect, disconnect } = useWhatsappConnection(companyId);

  // Cargar Facebook SDK
  useEffect(() => {
    if (document.getElementById('fb-sdk')) return;

    window.fbAsyncInit = function () {
      window.FB?.init({
        appId:   META_APP_ID,
        cookie:  true,
        xfbml:   true,
        version: 'v19.0',
      });
    };

    const script = document.createElement('script');
    script.id  = 'fb-sdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, []);

  const handleConnectClick = useCallback(() => {
    if (!window.FB) {
      alert('Facebook SDK no cargado. Recarga la página e intenta de nuevo.');
      return;
    }

    // Guardar la URL exacta antes de abrir el popup (debe coincidir en el exchange)
    const currentUrl = window.location.href;

    window.FB.login(
      (response) => {
        console.log('[WhatsApp] FB.login response:', response);
        // Intentar con code primero, fallback a accessToken
        const code  = response.authResponse?.code;
        const token = response.authResponse?.accessToken;
        if (code) {
          connect(code, currentUrl, true);    // es authorization code
        } else if (token) {
          connect(token, currentUrl, false);  // es access token
        } else {
          console.warn('[WhatsApp] Embedded Signup cancelado', response);
        }
      },
      {
        config_id:                      EMBEDDED_CONFIG_ID,
        response_type:                  'code',
        override_default_response_type: true,
        extras: {
          setup:              {},
          featureType:        '',
          sessionInfoVersion: '3',
        },
      }
    );
  }, [connect]);

  const isLoading = status === 'loading' || status === 'connecting';

  // ── Sin configuración de Meta App ─────────────────────────────────────────
  if (!META_APP_ID || !EMBEDDED_CONFIG_ID) {
    return (
      <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-5">
        <p className="text-sm font-semibold text-amber-300 mb-1">⚠️ Configuración pendiente</p>
        <p className="text-xs text-amber-200/70">
          Agrega <code className="bg-amber-500/20 px-1 rounded">VITE_META_APP_ID</code> y{' '}
          <code className="bg-amber-500/20 px-1 rounded">VITE_META_EMBEDDED_SIGNUP_CONFIG_ID</code>{' '}
          al archivo <code className="bg-amber-500/20 px-1 rounded">.env.local</code> para habilitar esta función.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Estado de la conexión */}
      <div className={`rounded-xl border p-5 ${
        connection.connected
          ? 'bg-green-500/5 border-green-500/20'
          : 'bg-zinc-800/40 border-zinc-700'
      }`}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`h-3 w-3 rounded-full ${
            connection.connected ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'
          }`} />
          <span className={`text-sm font-semibold ${
            connection.connected ? 'text-green-300' : 'text-zinc-400'
          }`}>
            {connection.connected ? 'WhatsApp conectado' : 'WhatsApp no conectado'}
          </span>
        </div>

        {connection.connected && (
          <div className="grid grid-cols-2 gap-3 text-xs mb-4">
            <div>
              <p className="text-zinc-500 mb-0.5">Número</p>
              <p className="text-zinc-100 font-medium">{connection.phoneNumber}</p>
            </div>
            <div>
              <p className="text-zinc-500 mb-0.5">Nombre visible</p>
              <p className="text-zinc-100 font-medium">{connection.displayName}</p>
            </div>
            <div>
              <p className="text-zinc-500 mb-0.5">WABA ID</p>
              <p className="text-zinc-400 font-mono text-[10px]">{connection.wabaId}</p>
            </div>
            {connection.connectedAt && (
              <div>
                <p className="text-zinc-500 mb-0.5">Conectado</p>
                <p className="text-zinc-400">
                  {new Date(connection.connectedAt).toLocaleDateString('es-CO')}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Acciones */}
        {connection.connected ? (
          <Button
            onClick={disconnect}
            disabled={isLoading}
            loading={isLoading}
            variant="danger"
            size="sm"
          >
            Desconectar WhatsApp
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-400">
              Conecta tu número de WhatsApp Business con coexistencia — la app del teléfono
              seguirá funcionando mientras el CRM también recibe y envía mensajes.
            </p>
            <button
              onClick={handleConnectClick}
              disabled={isLoading}
              className="
                flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-medium
                transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                w-fit
              "
            >
              {isLoading ? (
                <><Spinner size="sm" /> Conectando...</>
              ) : (
                <>
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                  Conectar con Meta
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-sm text-red-300">❌ {error}</p>
        </div>
      )}

      {/* Instrucciones */}
      <div className="rounded-xl bg-zinc-800/40 border border-zinc-700/50 p-4">
        <p className="text-xs font-semibold text-zinc-300 mb-2">
          ¿Cómo funciona la coexistencia?
        </p>
        <ul className="text-xs text-zinc-500 space-y-1.5">
          <li>✅ Tu WhatsApp Business App en el teléfono sigue activa</li>
          <li>✅ El CRM también recibe y responde mensajes via API</li>
          <li>✅ La IA de Victoria responde automáticamente</li>
          <li>⚠️ Los mensajes enviados desde la app no aparecen en el CRM</li>
          <li>⚠️ Recomendamos usar el CRM como canal principal</li>
        </ul>
      </div>
    </div>
  );
}
