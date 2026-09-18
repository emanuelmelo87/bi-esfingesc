import { signInWithCredential, GoogleAuthProvider, signOut } from "firebase/auth";
import { collection, getDocs, doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { auth, db, ALLOWED_EMAIL_DOMAIN } from "./firebase-config.js";

const CND_URL =
  "https://virtual.tce.sc.gov.br/esfinge-web/esfinge-online/administracao/certidao/consulta-geral";
const RATIFICACOES_APP_ID = "0e41d18b-45c4-4fef-94d4-ec0eee70fe5b";
const RATIFICACOES_WS = "wss://paineistransparencia.tce.sc.gov.br/app/" + RATIFICACOES_APP_ID;
const RATIFICACOES_OBJECT_ID = "WMFemM"; // objeto "Tabela": Ano/Mês, Ranking, Nome Municipio, Situação

const logEl = document.getElementById("log");
const modoLabelEl = document.getElementById("modo-label");
const modo = new URLSearchParams(location.search).get("modo") || "manual";
modoLabelEl.textContent = "Modo: " + modo;

function log(msg, kind) {
  const line = document.createElement("div");
  line.className = kind ? "log-" + kind : "";
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log("[Radar e-Sfinge]", msg);
}

function normalizar(nome) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ");
}

// ── Autenticação ───────────────────────────────────────────────────────

function getGoogleToken() {
  return new Promise(function (resolve, reject) {
    chrome.identity.getAuthToken({ interactive: true }, function (token) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

async function signInComContaBetha() {
  log("Solicitando login Google...");
  const token = await getGoogleToken();
  log("Token obtido, trocando por sessão Firebase Auth...");
  const credential = GoogleAuthProvider.credential(null, token);
  const result = await signInWithCredential(auth, credential);
  const email = result.user.email || "";
  if (!email.toLowerCase().endsWith("@" + ALLOWED_EMAIL_DOMAIN)) {
    await signOut(auth);
    await chrome.storage.local.set({ auth_status: { signedIn: false } });
    throw new Error("Acesso restrito a contas @" + ALLOWED_EMAIL_DOMAIN + " (login com " + email + ")");
  }
  await chrome.storage.local.set({ auth_status: { signedIn: true, email: email } });
  log("Login confirmado: " + email, "ok");
  return result.user;
}

// ── Cache de municípios (nome normalizado → código IBGE) ────────────────

async function carregarMunicipios() {
  const snap = await getDocs(collection(db, "municipios"));
  const porNomeBusca = new Map();
  const porIbge = new Map();
  snap.forEach(function (d) {
    const m = d.data();
    porNomeBusca.set(m.nome_busca, m);
    porIbge.set(m.codigo_ibge, m);
  });
  log("Cache de municípios carregado: " + porIbge.size + " registros.");
  return { porNomeBusca, porIbge };
}

function resolverMunicipio(nomeScraped, porNomeBusca) {
  return porNomeBusca.get(normalizar(nomeScraped)) || null;
}

// ── Componente 1a — CND pública (aba oculta + scraping de DOM) ──────────

function extractCNDPublico() {
  var rows = Array.from(document.querySelectorAll("tbody tr"));
  return rows
    .map(function (tr) {
      var cells = tr.querySelectorAll("td");
      if (cells.length < 5) return null;
      var ente = (cells[0].innerText || "").trim();
      var bimestre = (cells[1].innerText || "").trim();
      var certidaoTexto = (cells[2].innerText || "").trim();
      var validade = (cells[3].innerText || "").trim();
      var labelEl = cells[4].querySelector(".p-tag-label");
      var numero = (labelEl ? labelEl.innerText : "").trim().replace("● ", "");
      return {
        ente: ente,
        bimestre: bimestre,
        status: certidaoTexto.indexOf("Falta de Dados") >= 0 ? "irregular" : "regular",
        validade: validade,
        numero: numero,
      };
    })
    .filter(Boolean);
}

function abrirAbaOculta(url) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.create({ url: url, active: false }, function (tab) {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      function onUpdated(tabId, info) {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          setTimeout(function () { resolve(tab); }, 2500); // settle: renderização Angular
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

function fecharAba(tab) {
  return chrome.tabs.remove(tab.id).catch(function () {});
}

async function capturarCND(porNomeBusca) {
  log("Abrindo CND pública em aba oculta...");
  const tab = await abrirAbaOculta(CND_URL);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractCNDPublico,
  });
  await fecharAba(tab);
  log("CND: " + result.length + " linhas raspadas.");

  const porIbge = new Map();
  let semMatch = 0;
  for (const row of result) {
    const municipio = resolverMunicipio(row.ente, porNomeBusca);
    if (!municipio) {
      semMatch++;
      log("CND: município não encontrado para \"" + row.ente + "\" — pulado.", "err");
      continue;
    }
    porIbge.set(municipio.codigo_ibge, {
      cnd_status: row.status,
      cnd_bimestre: row.bimestre,
      cnd_validade: row.validade,
      cnd_numero: row.numero,
      cnd_atualizado_em: serverTimestamp(),
    });
  }
  log("CND: " + porIbge.size + " municípios resolvidos" + (semMatch ? ", " + semMatch + " sem match" : "") + ".", "ok");
  return porIbge;
}

// ── Componente 1b — Ratificações Globais (WebSocket direto, público) ────

function qlikCall(ws, id, method, handle, params) {
  return new Promise(function (resolve, reject) {
    function onMsg(e) {
      const d = JSON.parse(e.data);
      if (d.id !== id) return;
      ws.removeEventListener("message", onMsg);
      if (d.error) reject(new Error(JSON.stringify(d.error)));
      else resolve(d.result);
    }
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, handle: handle, params: params }));
  });
}

function mapSituacao(situacaoTexto) {
  if (situacaoTexto.indexOf("No Prazo") >= 0) return "quitado";
  if (situacaoTexto.indexOf("Fora do Prazo") >= 0) return "atrasado";
  return "ausente";
}

async function capturarRatificacoes(porNomeBusca) {
  log("Conectando ao Qlik de Ratificações Globais...");
  const ws = new WebSocket(RATIFICACOES_WS);
  await new Promise(function (resolve, reject) {
    ws.onopen = resolve;
    ws.onerror = function () { reject(new Error("Falha ao conectar no WebSocket do Qlik.")); };
  });

  let id = 1;
  const openDoc = await qlikCall(ws, id++, "OpenDoc", -1, [RATIFICACOES_APP_ID]);
  const docHandle = openDoc.qReturn.qHandle;
  const getObj = await qlikCall(ws, id++, "GetObject", docHandle, [RATIFICACOES_OBJECT_ID]);
  const objHandle = getObj.qReturn.qHandle;

  // As linhas vêm ordenadas por Ano/Mês desc + Ranking asc — as primeiras 295 já são
  // a competência mais recente, uma linha por município.
  const dataPage = await qlikCall(ws, id++, "GetHyperCubeData", objHandle, [
    "/qHyperCubeDef",
    [{ qTop: 0, qLeft: 0, qHeight: 295, qWidth: 4 }],
  ]);
  ws.close();

  const rows = dataPage.qDataPages[0].qMatrix.map(function (r) {
    return { anoMes: r[0].qText, nomeMunicipio: r[2].qText, situacao: r[3].qText };
  });
  log("Ratificações: " + rows.length + " linhas (competência " + (rows[0] ? rows[0].anoMes : "?") + ").");

  const porIbge = new Map();
  let semMatch = 0;
  for (const row of rows) {
    const municipio = resolverMunicipio(row.nomeMunicipio, porNomeBusca);
    if (!municipio) {
      semMatch++;
      log("Ratificações: município não encontrado para \"" + row.nomeMunicipio + "\" — pulado.", "err");
      continue;
    }
    porIbge.set(municipio.codigo_ibge, {
      ratificacao_status: mapSituacao(row.situacao),
      ratificacao_atualizado_em: serverTimestamp(),
    });
  }
  log("Ratificações: " + porIbge.size + " municípios resolvidos" + (semMatch ? ", " + semMatch + " sem match" : "") + ".", "ok");
  return porIbge;
}

// ── Gravação combinada no Firestore ──────────────────────────────────────

async function gravarStatusOperacional(porIbge, porIbgeMunicipios) {
  if (porIbge.size === 0) {
    log("Nada para gravar.");
    return 0;
  }
  const batch = writeBatch(db);
  for (const [codigoIbge, campos] of porIbge) {
    const municipio = porIbgeMunicipios.get(codigoIbge);
    batch.set(
      doc(db, "status_operacional_atual", codigoIbge),
      Object.assign(
        { codigo_ibge: codigoIbge, municipio: municipio ? municipio.nome : "", atualizado_em: serverTimestamp() },
        campos
      ),
      { merge: true }
    );
  }
  await batch.commit();
  log("Gravados " + porIbge.size + " documentos em status_operacional_atual.", "ok");
  return porIbge.size;
}

function mesclarMapas(a, b) {
  const resultado = new Map(a);
  for (const [ibge, campos] of b) {
    resultado.set(ibge, Object.assign({}, resultado.get(ibge) || {}, campos));
  }
  return resultado;
}

// ── Orquestração ──────────────────────────────────────────────────────

async function main() {
  try {
    await signInComContaBetha();

    if (modo === "login") {
      log("Login concluído. Pode fechar esta aba.", "ok");
      return;
    }

    const { porNomeBusca, porIbge: municipiosPorIbge } = await carregarMunicipios();

    const cndPorIbge = await capturarCND(porNomeBusca);
    const ratifPorIbge = await capturarRatificacoes(porNomeBusca);
    const combinado = mesclarMapas(cndPorIbge, ratifPorIbge);
    const total = await gravarStatusOperacional(combinado, municipiosPorIbge);

    await chrome.storage.local.set({
      last_execution: {
        resumo: total + " municípios atualizados (CND + Ratificações)",
        timestamp: Date.now(),
      },
    });

    log("Concluído.", "ok");
    if (modo === "alarme") setTimeout(function () { window.close(); }, 2000);
  } catch (err) {
    log("Erro: " + err.message, "err");
  }
}

main();
