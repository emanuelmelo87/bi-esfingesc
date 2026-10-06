// Carga de chamados do Jira Atendimento: busca o filtro (JQL) cadastrado no
// portal, grava cada chamado em chamados/{chave} e registra a carga em
// "cargas" (fonte "jira"), como a carga do TCE. Chamado que sai do filtro não é
// apagado: vira aberto=false com o motivo (resolvido, aguardando…).
import { FieldValue } from "firebase-admin/firestore";

export const JIRA_BASE = "https://atendimento.betha.com.br";

// Filtro padrão, usado quando a agenda do Jira não tem um próprio. Fica no
// portal (src/lib/jira-jql.ts) para a tela mostrar o mesmo texto.
export { JQL_PADRAO } from "../../src/lib/jira-jql.ts";

const CAMPOS = [
  "summary", "status", "assignee", "priority", "issuetype", "created", "updated", "resolution", "resolutiondate",
  "customfield_10335", // Funcionalidades
  "customfield_32400", // Portfólio de Atendimento
  "customfield_10300", // Vertical (área)
  "customfield_10202", // Entidade
  "customfield_10331", // Município
  "customfield_21500", // Equipe responsável
  "customfield_24813", // SLO Atendimento
];

const PRIORIDADES = { 1: "1 - Muito alta", 2: "2 - Alta", 3: "3 - Media", 4: "4 - Baixa", 5: "5 - Muito baixa" };

// Campo de opção ({value}), de lista ([{value}…]) ou texto.
function valor(campo) {
  if (campo === null || campo === undefined) return "";
  if (Array.isArray(campo)) return campo.map(valor).filter(Boolean).join(", ");
  if (typeof campo === "object") return campo.value || campo.name || "";
  return String(campo);
}

// Mesma normalização do nome_busca gravado em `municipios`.
export function normalizarNome(nome) {
  return String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Formato curto que as telas já usam (src/lib/chamados.ts), igual ao do painel antigo.
export function normalizarChamado(issue) {
  const f = issue.fields || {};
  const slo = f.customfield_24813 || {};
  const atual = slo.ongoingCycle || null;
  const ciclos = slo.completeCycles || [];
  const estourado = !!(atual && atual.breached) || ciclos.some((c) => c.breached);
  let restante = atual ? atual.remainingTime : null;
  if ((restante === null || restante === undefined) && ciclos.length) {
    const ultimo = ciclos[ciclos.length - 1];
    restante = (ultimo.goalTime || 0) - (ultimo.elapsedTime || 0);
  }
  if (restante && typeof restante === "object") restante = restante.millis ?? null;
  const entidade = valor(f.customfield_10202);
  let municipio = valor(f.customfield_10331);
  // Sem município preenchido: "1234 - Prefeitura de X / SC" → "X / SC" → "X".
  if (!municipio && entidade.indexOf(" - ") >= 0) municipio = entidade.split(" - ").pop().split("/")[0].trim();
  return {
    k: issue.key,
    s: f.summary || "",
    st: f.status ? f.status.name : "",
    sc: f.status && f.status.statusCategory ? f.status.statusCategory.name : "",
    a: f.assignee ? f.assignee.displayName : "Sem responsável",
    p: (f.priority && PRIORIDADES[f.priority.id]) || (f.priority ? f.priority.name : "-"),
    t: f.issuetype ? f.issuetype.name : "",
    c: f.created || null,
    u: f.updated || null,
    f: valor(f.customfield_10335),
    pf: valor(f.customfield_32400) || "Não definido",
    v: valor(f.customfield_10300) || "Não definida",
    e: entidade,
    m: municipio,
    eq: valor(f.customfield_21500) || "Não definida",
    br: estourado,
    rem: restante === undefined ? null : restante,
    paused: !!(atual && atual.paused),
  };
}

// Por que um chamado saiu do filtro, olhando como ele está agora no Jira.
export function motivoSaida(issue) {
  if (!issue) return "nao_encontrado";
  const f = issue.fields || {};
  if (f.resolution || (f.status && f.status.statusCategory && f.status.statusCategory.key === "done")) return "resolvido";
  if (f.status && /^aguardando/i.test(f.status.name)) return "aguardando";
  return "fora_do_filtro";
}

async function buscar(credencial, jql, campos) {
  const auth = "Basic " + Buffer.from(credencial.usuario + ":" + credencial.senha).toString("base64");
  const issues = [];
  let total = 0;
  for (let startAt = 0; startAt === 0 || startAt < total; startAt += 100) {
    const resp = await fetch(JIRA_BASE + "/rest/api/2/search", {
      method: "POST",
      headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json", "X-Atlassian-Token": "no-check" },
      // validateQuery "warn": uma chave que não existe mais não derruba a busca "key in (…)".
      body: JSON.stringify({ jql, startAt, maxResults: 100, fields: campos, validateQuery: "warn" }),
      signal: AbortSignal.timeout(60000),
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("Login no Jira recusado (HTTP " + resp.status + ") — confira o usuário e a senha em JIRA_CREDENCIAL.");
    }
    if (!resp.ok) throw new Error("Jira respondeu " + resp.status + ": " + (await resp.text()).slice(0, 300));
    const dados = await resp.json();
    total = dados.total || 0;
    issues.push(...(dados.issues || []));
    if (!dados.issues || dados.issues.length === 0 || startAt > 5000) break;
  }
  return { issues, total };
}

async function gravarEmLotes(db, operacoes) {
  for (let i = 0; i < operacoes.length; i += 400) {
    const batch = db.batch();
    for (const [ref, dados] of operacoes.slice(i, i + 400)) batch.set(ref, dados, { merge: true });
    await batch.commit();
  }
}

export async function executarCargaJira({ db, credencial, jql, modo }) {
  const inicio = Date.now();
  const cargaRef = db.collection("cargas").doc();
  const alertas = [];
  const log = (msg) => console.log("[Jira] " + msg);
  await cargaRef.set({
    fonte: "jira",
    tipo: "jira",
    modo,
    usuario: "nuvem",
    periodo: null,
    status: "em_andamento",
    etapa: "Buscando chamados no Jira",
    iniciado_em: new Date(inicio),
    concluido_em: null,
    pulso_em: FieldValue.serverTimestamp(),
  });
  try {
    const { issues, total } = await buscar(credencial, jql, CAMPOS);
    log(issues.length + " de " + total + " chamados lidos.");
    if (issues.length < total) alertas.push({ fonte: "Jira", mensagem: "só " + issues.length + " de " + total + " chamados foram lidos." });

    const vistos = new Map();
    for (const issue of issues) if (!vistos.has(issue.key)) vistos.set(issue.key, normalizarChamado(issue));
    const atuais = [...vistos.values()];

    const cadastro = new Set((await db.collection("municipios").get()).docs.map((d) => d.get("nome_busca")));
    const semMunicipio = atuais.filter((c) => !c.m).map((c) => c.k);
    const foraDoCadastro = atuais.filter((c) => c.m && !cadastro.has(normalizarNome(c.m)));
    if (semMunicipio.length) alertas.push({ fonte: "Jira", mensagem: semMunicipio.length + " chamado(s) sem município: " + semMunicipio.slice(0, 10).join(", ") + "." });
    if (foraDoCadastro.length) {
      alertas.push({
        fonte: "Jira",
        mensagem: foraDoCadastro.length + " chamado(s) com município fora do cadastro: " + foraDoCadastro.slice(0, 10).map((c) => c.k + " (" + c.m + ")").join(", ") + ".",
      });
    }

    const abertosAntes = new Set((await db.collection("chamados").where("aberto", "==", true).get()).docs.map((d) => d.id));
    const agora = new Date();
    const novos = atuais.filter((c) => !abertosAntes.has(c.k));
    const existentes = novos.length ? await db.getAll(...novos.map((c) => db.collection("chamados").doc(c.k))) : [];
    const jaExistiam = new Set(existentes.filter((s) => s.exists).map((s) => s.id));
    await gravarEmLotes(
      db,
      atuais.map((c) => [
        db.collection("chamados").doc(c.k),
        Object.assign({}, c, { aberto: true, visto_em: agora, saiu_em: null, motivo_saida: null }, jaExistiam.has(c.k) || abertosAntes.has(c.k) ? {} : { primeira_vez_em: agora }),
      ])
    );

    // Saíram do filtro desde a última carga: pergunta ao Jira como eles estão agora.
    const sairam = [...abertosAntes].filter((k) => !vistos.has(k));
    const situacao = new Map();
    for (let i = 0; i < sairam.length; i += 50) {
      const lote = sairam.slice(i, i + 50);
      const { issues: agoraNoJira } = await buscar(credencial, "key in (" + lote.join(",") + ")", ["status", "resolution", "resolutiondate"]);
      for (const issue of agoraNoJira) situacao.set(issue.key, issue);
    }
    let resolvidos = 0;
    await gravarEmLotes(
      db,
      sairam.map((k) => {
        const issue = situacao.get(k);
        const motivo = motivoSaida(issue);
        if (motivo === "resolvido") resolvidos++;
        const f = (issue && issue.fields) || {};
        return [
          db.collection("chamados").doc(k),
          {
            aberto: false,
            saiu_em: agora,
            motivo_saida: motivo,
            status_saida: f.status ? f.status.name : null,
            resolucao: f.resolution ? f.resolution.name : null,
            resolvido_em: f.resolutiondate || null,
          },
        ];
      })
    );

    const totais = { no_filtro: atuais.length, total_jira: total, novos: novos.length, atualizados: atuais.length - novos.length, sairam: sairam.length, resolvidos };
    log("Concluído: " + JSON.stringify(totais));
    await cargaRef.set(
      { status: "sucesso", erro: null, alertas, totais, jql, concluido_em: FieldValue.serverTimestamp(), duracao_ms: Date.now() - inicio, etapa: null },
      { merge: true }
    );
    return { cargaId: cargaRef.id, erro: null, alertas: alertas.length, totais };
  } catch (err) {
    console.error("[Jira] " + err.message);
    await cargaRef.set(
      { status: "erro", erro: err.message, alertas, jql, concluido_em: FieldValue.serverTimestamp(), duracao_ms: Date.now() - inicio, totais: null },
      { merge: true }
    );
    return { cargaId: cargaRef.id, erro: err.message, alertas: alertas.length };
  }
}
