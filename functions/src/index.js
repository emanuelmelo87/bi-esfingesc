// Carga na nuvem: a mesma carga da extensão (Extencao-BIEsfinge/src/carga.js),
// rodando no Cloud Functions com Chrome headless — funciona com o PC desligado.
// Quando a carga termina com problema, o Claude escreve um diagnóstico no
// registro da carga (cargas/{id}.diagnostico_ia), que aparece no Controle de Cargas.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import Anthropic from "@anthropic-ai/sdk";
import { executarCarga } from "../../Extencao-BIEsfinge/src/carga.js";
import { criarPlataformaNuvem } from "./plataforma-nuvem.js";

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// JSON [{"matricula":"…","senha":"…"}] — cadastrado com `firebase functions:secrets:set TCE_CREDENCIAIS`.
const TCE_CREDENCIAIS = defineSecret("TCE_CREDENCIAIS");
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const OPCOES = {
  region: "southamerica-east1",
  memory: "2GiB",
  timeoutSeconds: 1800,
  secrets: [TCE_CREDENCIAIS, ANTHROPIC_API_KEY],
};
const CONFIG = "config/carga_nuvem";
// Igual à trava da extensão (CARGA_TRAVADA_MS): uma carga "em andamento" há mais
// que isso morreu no meio e não segura a próxima.
const TRAVA_MS = 30 * 60 * 1000;
const COMPETENCIA_INICIO_PADRAO = "05/2026";

// "MM/AAAA" do mês anterior, no fuso de Brasília.
function competenciaVigente() {
  const [ano, mes] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-")
    .map(Number);
  const d = new Date(ano, mes - 2, 1);
  return String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

async function pegarTrava() {
  return db.runTransaction(async (t) => {
    const snap = await t.get(db.doc(CONFIG));
    const desde = snap.exists ? snap.get("em_andamento_desde") : null;
    if (desde && Date.now() - desde.toMillis() < TRAVA_MS) return false;
    t.set(db.doc(CONFIG), { em_andamento_desde: new Date() }, { merge: true });
    return true;
  });
}

async function rodarCarga() {
  if (!(await pegarTrava())) {
    console.log("Outra carga na nuvem está em andamento — esta foi pulada.");
    return { pulada: true };
  }
  let browser = null;
  try {
    const config = (await db.doc(CONFIG).get()).data() || {};
    browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    const resultado = await executarCarga(
      criarPlataformaNuvem({
        db,
        browser,
        credenciais: JSON.parse(TCE_CREDENCIAIS.value() || "[]"),
        parametros: {
          modo: "nuvem",
          competencia_inicio: config.competencia_inicio || COMPETENCIA_INICIO_PADRAO,
          competencia_fim: competenciaVigente(),
        },
      })
    );
    const incompleta = resultado.cobertura.some((c) => c.ratificacoes !== c.total || c.modulos !== c.total);
    if (resultado.erro || resultado.alertas.length || incompleta) await diagnosticar(resultado);
    return { cargaId: resultado.cargaId, erro: resultado.erro, alertas: resultado.alertas.length };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await db.doc(CONFIG).set({ em_andamento_desde: null }, { merge: true });
  }
}

// Claude lê o resultado e o log e escreve, em português, o que deu errado e o
// que fazer. Falhar aqui não derruba a carga: ela já está registrada.
async function diagnosticar(resultado) {
  try {
    const anteriores = await db.collection("cargas").orderBy("iniciado_em", "desc").limit(3).get();
    const anterior = anteriores.docs.map((d) => d.data()).find((c) => c.status !== "em_andamento" && c.concluido_em) || null;
    const contexto = {
      carga_atual: {
        erro: resultado.erro,
        alertas: resultado.alertas,
        cobertura: resultado.cobertura,
        log_final: resultado.log.slice(-150),
      },
      carga_anterior: anterior && {
        modo: anterior.modo,
        status: anterior.status,
        erro: anterior.erro,
        alertas: anterior.alertas,
        cobertura: (anterior.cobertura || []).map((c) => ({ competencia: c.competencia, ratificacoes: c.ratificacoes, modulos: c.modulos, total: c.total })),
      },
    };
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
    const resposta = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      system:
        "Você confere a carga de dados do BI eSfinge SC, que lê do TCE-SC, para os 295 municípios de Santa Catarina, " +
        "a CND, a ratificação geral e o envio dos módulos do e-Sfinge, e grava no Firestore. A carga roda de hora em hora. " +
        "Os módulos vêm de um painel restrito que exige login com matrícula do TCE; cada matrícula só enxerga os entes a que tem acesso. " +
        "Escreva um diagnóstico curto em português, para quem cuida da carga: o que deu errado, a causa mais provável " +
        "(com base no log e na comparação com a carga anterior) e o que fazer. No máximo 6 linhas, sem markdown.",
      messages: [{ role: "user", content: JSON.stringify(contexto) }],
    });
    const texto = resposta.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    if (texto) await db.collection("cargas").doc(resultado.cargaId).set({ diagnostico_ia: texto }, { merge: true });
  } catch (err) {
    console.error("Diagnóstico do Claude falhou:", err.message);
  }
}

// De hora em hora das 08:30 às 18:30 (Brasília) — meia hora depois dos
// horários da extensão, para as duas não rodarem juntas.
export const cargaAgendada = onSchedule(
  { ...OPCOES, schedule: "30 8-18 * * *", timeZone: "America/Sao_Paulo", retryCount: 0 },
  async () => {
    await rodarCarga();
  }
);

// Botão "Rodar na nuvem agora" do Controle de Cargas — só administrador.
export const rodarCargaAgora = onCall(OPCOES, async (request) => {
  const token = request.auth && request.auth.token;
  const email = token && token.email ? token.email.toLowerCase() : "";
  if (!token || !token.email_verified || token.firebase.sign_in_provider !== "google.com" || !email.endsWith("@betha.com.br")) {
    throw new HttpsError("permission-denied", "Acesso restrito a contas @betha.com.br.");
  }
  const usuario = (await db.collection("usuarios").doc(email).get()).data();
  if (!usuario || usuario.perfil !== "ADMIN_GERAL" || usuario.ativo !== true) {
    throw new HttpsError("permission-denied", "Só administradores podem rodar a carga na nuvem.");
  }
  return rodarCarga();
});
