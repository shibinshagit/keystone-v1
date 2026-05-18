import path from 'path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;

  const parsed = JSON.parse(raw);
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
}

if (!getApps().length) {
  const serviceAccount = getServiceAccount();
  initializeApp(
    serviceAccount
      ? {
          credential: cert(serviceAccount),
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || serviceAccount.project_id,
        }
      : {
          credential: cert(path.resolve(process.cwd(), 'firebase-admin-key.json')),
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'keystone-map3d',
        },
  );
}

export const adminDb = getFirestore();
