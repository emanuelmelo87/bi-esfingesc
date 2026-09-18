// One-off bootstrap: promotes one email to ADMIN_GERAL in the `usuarios` collection.
// The doc is normally auto-provisioned as LEITURA on first login (see auth-context.tsx) —
// this script exists only to break the chicken-and-egg problem for the very first admin.
//
// Usage: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-admin.mjs <email>

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON path.");
  process.exit(1);
}

const email = process.argv[2]?.toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/seed-admin.mjs <email>");
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, "utf8"))) });
const db = getFirestore();

await db.collection("usuarios").doc(email).set(
  {
    email,
    perfil: "ADMIN_GERAL",
    ativo: true,
    criado_em: FieldValue.serverTimestamp(),
    ultimo_login: FieldValue.serverTimestamp(),
  },
  { merge: true }
);

console.log(`${email} agora é ADMIN_GERAL.`);
