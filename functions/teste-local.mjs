// Roda a carga da nuvem neste PC (Chrome instalado, invisível) contra o banco real,
// para conferir o caminho Admin SDK + Puppeteer antes do deploy.
// Uso: GOOGLE_APPLICATION_CREDENTIALS=<chave> node teste-local.mjs MM/AAAA
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const saida = path.resolve("lib/teste-local.mjs"); // dentro de functions/ para achar os pacotes
await build({
  stdin: {
    contents: 'export { executarCarga } from "../Extencao-BIEsfinge/src/carga.js"; export { criarPlataformaNuvem } from "./src/plataforma-nuvem.js";',
    resolveDir: process.cwd(),
  },
  bundle: true, format: "esm", platform: "node", outfile: saida, packages: "external",
  alias: { "firebase/firestore": "./src/firestore-admin.js" },
  logLevel: "silent",
});
const { executarCarga, criarPlataformaNuvem } = await import(pathToFileURL(saida).href);

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const competencia = process.argv[2];
try {
  const r = await executarCarga(criarPlataformaNuvem({ db, browser, credenciais: [], parametros: { modo: "nuvem", competencia_inicio: competencia, competencia_fim: competencia } }));
  console.log(JSON.stringify({ cargaId: r.cargaId, erro: r.erro, alertas: r.alertas, cobertura: r.cobertura.map((c) => [c.competencia, c.ratificacoes, c.modulos]) }));
} finally {
  await browser.close();
}
