// One-off seed: populates the `municipios` collection from IBGE's public API
// (Santa Catarina, UF 42) with nome + codigo_ibge only. fornecedor/canal_atendimento
// stay null — filled in manually later via the web app.
//
// Usage: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-municipios.mjs

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error("Set GOOGLE_APPLICATION_CREDENTIALS to the service account JSON path.");
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, "utf8"))) });
const db = getFirestore();

function normalizar(nome) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ") // pontuação (apóstrofo, hífen...) vira espaço, nunca some
    .trim()
    .replace(/\s+/g, " ");
}

const resp = await fetch(
  "https://servicodados.ibge.gov.br/api/v1/localidades/estados/42/municipios"
);
if (!resp.ok) {
  throw new Error(`IBGE API respondeu ${resp.status}`);
}
const municipios = await resp.json();

if (municipios.length !== 295) {
  console.warn(`Esperava 295 municípios, API retornou ${municipios.length}.`);
}

const batch = db.batch();
for (const m of municipios) {
  const codigoIbge = String(m.id);
  batch.set(
    db.collection("municipios").doc(codigoIbge),
    {
      codigo_ibge: codigoIbge,
      nome: m.nome,
      nome_busca: normalizar(m.nome),
      fornecedor: null,
      canal_atendimento: null,
    },
    { merge: true }
  );
}
await batch.commit();

console.log(`Semeados ${municipios.length} municípios em 'municipios'.`);
