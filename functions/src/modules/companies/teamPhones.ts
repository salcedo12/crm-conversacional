import { db } from '../../lib/admin';
import { logger } from '../../utils/logger';

interface TeamPhonesCacheEntry {
  phones: Set<string>;
  expiresAt: number;
}

const teamPhonesCache = new Map<string, TeamPhonesCacheEntry>();
const TEAM_PHONES_CACHE_TTL_MS = 60_000;

function addPhoneToSet(phones: Set<string>, rawPhone: unknown) {
  if (typeof rawPhone === 'string' && rawPhone.trim()) {
    const cd = rawPhone.replace(/\D/g, '');
    if (cd.length >= 7) {
      phones.add(cd);
      phones.add(cd.slice(-10));
    }
  }
}

/**
 * Determina si un número telefónico pertenece al equipo interno de la empresa:
 * - Teléfono de conexión QR de cualquier asesor (advisorWhatsappConnections)
 * - Teléfono registrado en el perfil de cualquier usuario de la empresa (users/{uid}.phone, personalPhone, additionalPhones)
 * - Líneas corporativas oficiales de la empresa (línea 317 y todas las rutas en channelRoutes)
 *
 * Se usa para ignorar automáticamente mensajes y llamadas entre compañeros de trabajo,
 * impidiendo que se creen prospectos comerciales (leads) o se filtren chats internos en el CRM.
 */
export async function isCompanyTeamPhone(companyId: string, rawPhone: string): Promise<boolean> {
  if (!rawPhone) return false;
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 7) return false;

  const now = Date.now();
  let cached = teamPhonesCache.get(companyId);
  if (!cached || cached.expiresAt <= now) {
    const phones = new Set<string>();

    try {
      // 1. Teléfonos de conexión QR de asesores (advisorWhatsappConnections)
      const connsSnap = await db.collection('companies').doc(companyId).collection('advisorWhatsappConnections').get();
      for (const d of connsSnap.docs) {
        addPhoneToSet(phones, d.data().phone);
      }

      // 2. Teléfonos en users de la empresa (phone, personalPhone, additionalPhones)
      const usersSnap = await db.collection('companies').doc(companyId).collection('users').get();
      for (const d of usersSnap.docs) {
        const uData = d.data();
        addPhoneToSet(phones, uData.phone);
        addPhoneToSet(phones, uData.personalPhone);
        if (Array.isArray(uData.additionalPhones)) {
          for (const ap of uData.additionalPhones) {
            addPhoneToSet(phones, ap);
          }
        }
      }

      // 3. Líneas corporativas conocidas (Central 317)
      phones.add('573176820728');
      phones.add('3176820728');
      phones.add('573172288317');
      phones.add('3172288317');

      // 4. Teléfonos personales conocidos de asesores / staff
      // Karen Ramirez (personal)
      phones.add('573222013822');
      phones.add('3222013822');
      // Claudia Bolaños (personal)
      phones.add('573133208056');
      phones.add('3133208056');
      // Juana María Ávila Rojas (personal)
      phones.add('573016068151');
      phones.add('3016068151');
      // Edwin Mauricio Ramirez Vega (personal y línea alterna)
      phones.add('573156024475');
      phones.add('3156024475');
      phones.add('573223508759');
      phones.add('3223508759');
      // Adriana Garzón Osorio (personal)
      phones.add('573153943232');
      phones.add('3153943232');
      // Luisa Fernanda Zuluaga Mejía (personal)
      phones.add('573185799797');
      phones.add('3185799797');
      // Jhon Toledo (Jefe / Gerencia Meraki)
      phones.add('573112222105');
      phones.add('3112222105');
      // Luis Carlos Machado Tovar (personal)
      phones.add('573107527056');
      phones.add('3107527056');
      // Camilo (Personal / Operaciones de campo Cañón de Arizona)
      phones.add('573204499031');
      phones.add('3204499031');

      // 5. Todas las rutas de canales registradas (channelRoutes)
      const routesSnap = await db.collection('channelRoutes').get();
      for (const rDoc of routesSnap.docs) {
        const rData = rDoc.data();
        if (rData.companyId === companyId || !rData.companyId) {
          addPhoneToSet(phones, rData.identifier);
        }
      }
    } catch (err) {
      logger.warn('[TeamPhones] Error cargando teléfonos de equipo', { companyId, err });
    }

    cached = { phones, expiresAt: now + TEAM_PHONES_CACHE_TTL_MS };
    teamPhonesCache.set(companyId, cached);
  }

  if (cached.phones.has(digits)) return true;
  if (digits.length >= 10 && cached.phones.has(digits.slice(-10))) return true;
  return false;
}

export function clearTeamPhonesCache(companyId?: string): void {
  if (companyId) {
    teamPhonesCache.delete(companyId);
  } else {
    teamPhonesCache.clear();
  }
}
