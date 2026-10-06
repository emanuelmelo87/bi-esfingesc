// Carga na nuvem: a mesma carga da extensão (Extencao-BIEsfinge/src/carga.js),
// rodando no Cloud Functions com Chrome headless — funciona com o PC desligado.
// Os horários vêm da agenda cadastrada no portal (config/agenda_nuvem).
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { executarCarga } from "../../Extencao-BIEsfinge/src/carga.js";
import { criarPlataformaNuvem } from "./plataforma-nuvem.js";
import { agoraBrasilia, horariosVencidos } from "./agenda.js";
import { executarCargaJira, JQL_PADRAO } from "./jira.js";

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// JSON [{"matricula":"…","senha":"…"}] — cadastrado com `firebase functions:secrets:set TCE_CREDENCIAIS`.
const TCE_CREDENCIAIS = defineSecret("TCE_CREDENCIAIS");
// Usuário de serviço do Jira: {"usuario":"…","senha":"…"} ou o código Base64 do
// cabeçalho Basic — `firebase functions:secrets:set JIRA_CREDENCIAL`.
const JIRA_CREDENCIAL = defineSecret("JIRA_CREDENCIAL");

const OPCOES = {
  region: "southamerica-east1",
  memory: "2GiB",
  timeoutSeconds: 1800,
  secrets: [TCE_CREDENCIAIS],
};
// Agenda (editada no portal por admin) e estado interno da carga (só a função grava).
const AGENDA = "config/agenda_nuvem";
const ESTADO = "config/carga_nuvem";
const AGENDA_JIRA = "config/agenda_jira";
const ESTADO_JIRA = "config/carga_jira";
const OPCOES_JIRA = { region: "southamerica-east1", memory: "256MiB", timeoutSeconds: 540, secrets: [JIRA_CREDENCIAL] };
// Igual à trava da extensão (CARGA_TRAVADA_MS): uma carga "em andamento" há mais
// que isso morreu no meio e não segura a próxima.
const TRAVA_MS = 30 * 60 * 1000;
const COMPETENCIA_INICIO_PADRAO = "05/2026";

// "MM/AAAA" do mês anterior, no fuso de Brasília.
function competenciaVigente() {
  const [ano, mes] = agoraBrasilia().data.split("-").map(Number);
  const d = new Date(ano, mes - 2, 1);
  return String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
}

async function pegarTrava(estado) {
  return db.runTransaction(async (t) => {
    const snap = await t.get(db.doc(estado));
    const desde = snap.exists ? snap.get("em_andamento_desde") : null;
    if (desde && Date.now() - desde.toMillis() < TRAVA_MS) return false;
    t.set(db.doc(estado), { em_andamento_desde: new Date() }, { merge: true });
    return true;
  });
}

// Horários da agenda que chegaram e ainda não dispararam hoje — já marcados como
// disparados, numa transação, para dois relógios não rodarem o mesmo horário.
async function horariosParaDisparar(agendaPath, estadoPath) {
  const agora = agoraBrasilia();
  return db.runTransaction(async (t) => {
    const agenda = (await t.get(db.doc(agendaPath))).data();
    const estado = (await t.get(db.doc(estadoPath))).data() || {};
    const feitos = estado.disparos_dia && estado.disparos_dia.data === agora.data ? estado.disparos_dia.horarios : [];
    const novos = horariosVencidos(agenda, agora, feitos);
    if (novos.length) t.set(db.doc(estadoPath), { disparos_dia: { data: agora.data, horarios: feitos.concat(novos) } }, { merge: true });
    return novos;
  });
}

// Botões "Rodar agora" do Controle de Cargas — só administrador.
async function exigirAdmin(request) {
  const token = request.auth && request.auth.token;
  const email = token && token.email ? token.email.toLowerCase() : "";
  if (!token || !token.email_verified || token.firebase.sign_in_provider !== "google.com" || !email.endsWith("@betha.com.br")) {
    throw new HttpsError("permission-denied", "Acesso restrito a contas @betha.com.br.");
  }
  const usuario = (await db.collection("usuarios").doc(email).get()).data();
  if (!usuario || usuario.perfil !== "ADMIN_GERAL" || usuario.ativo !== true) {
    throw new HttpsError("permission-denied", "Só administradores podem rodar a carga na nuvem.");
  }
}

async function rodarCarga() {
  if (!(await pegarTrava(ESTADO))) {
    console.log("Outra carga na nuvem está em andamento — esta foi pulada.");
    return { pulada: true };
  }
  let browser = null;
  try {
    const agenda = (await db.doc(AGENDA).get()).data() || {};
    browser = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
    const resultado = await executarCarga(
      criarPlataformaNuvem({
        db,
        browser,
        credenciais: JSON.parse(TCE_CREDENCIAIS.value() || "[]"),
        parametros: {
          modo: "nuvem",
          competencia_inicio: agenda.competencia_inicio || COMPETENCIA_INICIO_PADRAO,
          competencia_fim: competenciaVigente(),
        },
      })
    );
    return { cargaId: resultado.cargaId, erro: resultado.erro, alertas: resultado.alertas.length };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await db.doc(ESTADO).set({ em_andamento_desde: null }, { merge: true });
  }
}

// Relógio: a cada 5 minutos confere a agenda; quando chega um horário, marca
// como disparado (numa transação, para dois relógios não dispararem o mesmo
// horário) e roda a carga. Sem horário vencido, termina em milissegundos.
export const relogioCarga = onSchedule(
  { ...OPCOES, schedule: "every 5 minutes", timeZone: "America/Sao_Paulo", retryCount: 0 },
  async () => {
    const vencidos = await horariosParaDisparar(AGENDA, ESTADO);
    if (!vencidos.length) return;
    console.log("Agenda: disparando a carga das " + vencidos.join(", ") + ".");
    await rodarCarga();
  }
);

// Botão "Rodar na nuvem agora" do Controle de Cargas — só administrador.
export const rodarCargaAgora = onCall(OPCOES, async (request) => {
  await exigirAdmin(request);
  return rodarCarga();
});

// ── Carga de chamados do Jira ─────────────────────────────────────────────

async function rodarCargaJira(modo) {
  if (!(await pegarTrava(ESTADO_JIRA))) {
    console.log("Outra carga do Jira está em andamento — esta foi pulada.");
    return { pulada: true };
  }
  try {
    const agenda = (await db.doc(AGENDA_JIRA).get()).data() || {};
    return await executarCargaJira({
      db,
      credencial: JIRA_CREDENCIAL.value(),
      jql: (agenda.jql || "").trim() || JQL_PADRAO,
      modo,
    });
  } finally {
    await db.doc(ESTADO_JIRA).set({ em_andamento_desde: null }, { merge: true });
  }
}

export const relogioJira = onSchedule(
  { ...OPCOES_JIRA, schedule: "every 5 minutes", timeZone: "America/Sao_Paulo", retryCount: 0 },
  async () => {
    const vencidos = await horariosParaDisparar(AGENDA_JIRA, ESTADO_JIRA);
    if (!vencidos.length) return;
    console.log("Agenda Jira: disparando a carga das " + vencidos.join(", ") + ".");
    await rodarCargaJira("alarme");
  }
);

export const rodarJiraAgora = onCall(OPCOES_JIRA, async (request) => {
  await exigirAdmin(request);
  return rodarCargaJira("manual");
});
