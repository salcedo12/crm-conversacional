import { Alert, AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

let isChecking = false;

/**
 * Comprueba si hay una actualización remota (OTA) disponible en EAS Update
 * y la descarga. Si se encuentra una nueva versión, le pregunta al usuario
 * si desea reiniciar la aplicación ahora para aplicarla.
 *
 * @param silent - Si es true, no muestra alertas cuando ya está al día o en caso de error silencioso.
 */
export async function checkAndApplyUpdate(silent = true): Promise<boolean> {
  if (__DEV__ || !Updates.isEnabled) {
    if (!silent) {
      Alert.alert(
        'Modo Desarrollo / Emulador',
        `Las actualizaciones OTA automáticas están inactivas en modo de desarrollo o emulador.\nVersión compilada: ${Updates.runtimeVersion || '1.0.51'}`
      );
    }
    return false;
  }

  if (isChecking) return false;
  isChecking = true;

  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) {
      const fetchResult = await Updates.fetchUpdateAsync();
      if (fetchResult.isNew) {
        Alert.alert(
          '🎉 Nueva versión disponible',
          'Se ha descargado una actualización de Meraki CRM con mejoras recientes. ¿Deseas reiniciar la aplicación ahora para aplicarla?',
          [
            { text: 'Más tarde', style: 'cancel' },
            {
              text: 'Reiniciar ahora',
              onPress: () => {
                void Updates.reloadAsync();
              },
            },
          ]
        );
        return true;
      }
    } else if (!silent) {
      Alert.alert(
        'Aplicación al día',
        `Ya cuentas con la versión más reciente instalada (${Updates.runtimeVersion || '1.0.51'}).`
      );
    }
  } catch (err: any) {
    if (!silent) {
      Alert.alert(
        'Comprobación de actualización',
        'No se pudo conectar al servidor de actualizaciones. Por favor verifica tu conexión a internet.'
      );
    }
    console.warn('[updateService] Error comprobando actualizaciones:', err);
  } finally {
    isChecking = false;
  }

  return false;
}

/**
 * Registra el observador de ciclo de vida (AppState) para comprobar
 * actualizaciones OTA al iniciar la app y cada vez que el usuario regresa
 * a la aplicación desde segundo plano (throttled a máx 1 vez cada 2 min).
 */
export function registerAppStateUpdateChecker() {
  if (__DEV__ || !Updates.isEnabled) return () => {};

  // Chequeo inicial suave después de 3 segundos de carga
  const initialTimer = setTimeout(() => {
    void checkAndApplyUpdate(true);
  }, 3000);

  let lastState: AppStateStatus = AppState.currentState;
  let lastCheckTime = Date.now();

  const subscription = AppState.addEventListener('change', (nextState) => {
    if (lastState.match(/inactive|background/) && nextState === 'active') {
      // Evitar comprobar más de una vez cada 2 minutos
      if (Date.now() - lastCheckTime > 120000) {
        lastCheckTime = Date.now();
        void checkAndApplyUpdate(true);
      }
    }
    lastState = nextState;
  });

  return () => {
    clearTimeout(initialTimer);
    subscription.remove();
  };
}
