// One-off: remove o campo prioridade_ratificacao (não usado mais — feature
// removida da tela Ratificação Geral) de todos os docs de status_operacional_atual.
//
// Usage: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/remover-prioridade.mjs

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON path.");
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, "utf8"))) });
const db = getFirestore();

// Sem query por "campo existe" no Firestore — busca tudo (só 295 docs) e filtra local.
const snap = await db.collection("status_operacional_atual").get();
const comCampo = snap.docs.filter((d) => "prioridade_ratificacao" in d.data());
console.log(`${comCampo.length} documento(s) com o campo prioridade_ratificacao.`);

const batch = db.batch();
comCampo.forEach((d) => batch.update(d.ref, { prioridade_ratificacao: FieldValue.delete() }));
if (comCampo.length > 0) await batch.commit();

console.log(`Campo removido de ${comCampo.length} documento(s).`);
