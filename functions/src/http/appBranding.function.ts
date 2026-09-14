import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';
import { db } from '../lib/admin';
import { assertCompany, requireAuth, requireRole, ADMIN_ROLES } from '../lib/authContext';

const DEFAULT_BRANDING = {
  appName: 'Meraki CRM',
  tagline: 'Conversacional',
  logoUrl: '/meraki-logo.png',
  primaryColor: '#7c3aed',
};

const brandingRef = (companyId: string) =>
  db.collection('companies').doc(companyId).collection('appSettings').doc('branding');

const BrandingSchema = z.object({
  companyId: z.string().min(1),
  appName: z.string().trim().min(2).max(40),
  tagline: z.string().trim().max(60),
  logoUrl: z.string().trim().max(500),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const getAppBranding = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    const { companyId } = z.object({ companyId: z.string().min(1) }).parse(request.data);
    assertCompany(ctx, companyId);

    const snap = await brandingRef(companyId).get();
    const data = snap.exists ? snap.data() : {};

    return {
      ...DEFAULT_BRANDING,
      ...data,
      updatedAt: data?.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : null,
    };
  }
);

export const saveAppBranding = onCall(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (request) => {
    const ctx = requireAuth(request);
    requireRole(ctx, ADMIN_ROLES);

    const parse = BrandingSchema.safeParse(request.data);
    if (!parse.success) {
      throw new HttpsError('invalid-argument', 'Datos invalidos: ' + parse.error.message);
    }

    const { companyId, ...branding } = parse.data;
    assertCompany(ctx, companyId);

    await brandingRef(companyId).set({
      ...branding,
      companyId,
      updatedAt: Timestamp.now(),
    });

    return { ok: true };
  }
);
