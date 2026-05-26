import { onRequest } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import cors from 'cors';
import { db } from '../lib/admin';

const corsMiddleware = cors({ origin: true });

export const leads = onRequest(
  { region: 'us-central1', invoker: 'public' },
  (req, res) => {
    corsMiddleware(req, res, async () => {
      const companyId = req.query.companyId as string | undefined;

      // GET /leads?companyId=xxx  →  lista de leads con su última conversación
      if (req.method === 'GET') {
        if (!companyId) {
          res.status(400).json({ error: 'companyId requerido' });
          return;
        }

        const snapshot = await db
          .collection('leads')
          .where('companyId', '==', companyId)
          .orderBy('createdAt', 'desc')
          .get();

        const leadList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        res.status(200).json(leadList);
        return;
      }

      // POST /leads  →  crear lead manualmente (sin WhatsApp)
      if (req.method === 'POST') {
        const { name, phoneNumber, companyId: bodyCompanyId } = req.body;
        if (!phoneNumber || !bodyCompanyId) {
          res.status(400).json({ error: 'phoneNumber y companyId requeridos' });
          return;
        }

        const now = Timestamp.now();
        const ref = db.collection('leads').doc();
        await ref.set({
          name: name || `Lead ${phoneNumber}`,
          phoneNumber,
          companyId: bodyCompanyId,
          status: 'NEW',
          assignedLeadsCount: 0,
          createdAt: now,
          updatedAt: now,
        });

        res.status(201).json({ id: ref.id, message: 'Lead creado' });
        return;
      }

      res.sendStatus(405);
    });
  }
);
