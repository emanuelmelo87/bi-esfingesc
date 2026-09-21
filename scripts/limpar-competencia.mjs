// One-off: apaga todos os docs de status_por_competencia de uma competência
// específica. Usado pra limpar dados gravados por engano pelo bug do "atalho
// top-295" da extração de Ratificações Globais (pegava linhas de uma
// competência que ainda nem fechou — ver progress.js).
//
// Usage: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/limpar-competencia.mjs MM/AAAA

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON path.");
  process.exit(1);
}

const competencia = process.argv[2];
if (!/^\d{2}\/\d{4}$/.test(competencia || "")) {
  console.error("Usage: node scripts/limpar-competencia.mjs MM/AAAA");
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, "utf8"))) });
const db = getFirestore();

const snap = await db.collection("status_por_competencia").where("competencia", "==", competencia).get();
console.log(`${snap.size} documento(s) encontrados pra competência ${competencia}.`);

const batch = db.batch();
snap.forEach((d) => batch.delete(d.ref));
if (snap.size > 0) await batch.commit();

console.log(`${snap.size} documento(s) apagados.`);
