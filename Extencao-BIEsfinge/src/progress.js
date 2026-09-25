import { signInWithCredential, GoogleAuthProvider, signOut } from "firebase/auth";
import { collection, getDocs, doc, query, setDoc, updateDoc, where, writeBatch, serverTimestamp } from "firebase/firestore";
import { auth, db, ALLOWED_EMAIL_DOMAIN } from "./firebase-config.js";

const CND_URL =
  "https://virtual.tce.sc.gov.br/esfinge-web/esfinge-online/administracao/certidao/consulta-geral";
const RATIFICACOES_URL =
  "https://paineistransparencia.tce.sc.gov.br/extensions/appRatificacoesGlobais/index.html";
// appId "0e41d18b-45c4-4fef-94d4-ec0eee70fe5b", objeto pivot-table
// "a76276a9-7638-4c81-96a6-b504100f7457" (dims Nome Municipio × Mês/Ano, medida
// text(data_final_formatada)) — hardcoded dentro de extractRatificacoesGlobais,
// que roda injetada numa aba e não pode fechar sobre constantes deste escopo.
// Usamos esse pivot em vez do objeto "WMFemM" (tabela Ano/Mês, Ranking, Nome
// Municipio, Situação) porque o WMFemM só é populado depois que a competência
// fecha — pra competência em curso ele não tem nenhuma linha, mesmo quando
// municípios já ratificaram. O pivot já traz a competência em curso (com data
// real de ratificação por célula), então virou a única fonte.

const TCE_LOGIN_URL = "https://virtual.tce.sc.gov.br/login";
const TCE_TICKET_API = "https://api.virtual.tce.sc.gov.br/sgi/rest/usuarios/ticketQlik";
const QLIK_MODULOS_URL = "https://paineis.tce.sc.gov.br/custom/extensions/ExtratosEsfinge/index.html";

const logEl = document.getElementById("log");
const modoLabelEl = document.getElementById("modo-label");
const urlParams = new URLSearchParams(location.search);
const modo = urlParams.get("modo") || "manual";
// "MM/AAAA" a "MM/AAAA" — quando presente, este run busca cada competência do
// período (backfill), sem tocar em status_operacional_atual/snapshots_diarios
// (que são "estado atual"). "competencia" sozinho ainda funciona (1 mês só),
// pra não quebrar um link/atalho antigo.
const competenciaInicioParam = urlParams.get("competencia_inicio") || urlParams.get("competencia") || null;
const competenciaFimParam = urlParams.get("competencia_fim") || competenciaInicioParam;

// "MM/AAAA" -> AAAA*12+MM, pra comparar/iterar competências cronologicamente.
function competenciaParaChave(competencia) {
  const [mes, ano] = competencia.split("/").map(Number);
  return ano * 12 + mes;
}

// Lista "MM/AAAA" de inicio até fim, inclusive, em ordem cronológica (aceita
// os dois parâmetros trocados e corrige sozinho).
function listarCompetencias(inicio, fim) {
  let chaveInicio = competenciaParaChave(inicio);
  let chaveFim = competenciaParaChave(fim);
  if (chaveInicio > chaveFim) [chaveInicio, chaveFim] = [chaveFim, chaveInicio];
  const lista = [];
  for (let chave = chaveInicio; chave <= chaveFim; chave++) {
    const ano = Math.floor((chave - 1) / 12);
    const mes = chave - ano * 12;
    lista.push(String(mes).padStart(2, "0") + "/" + ano);
  }
  return lista;
}

const competenciasAlvo = competenciaInicioParam ? listarCompetencias(competenciaInicioParam, competenciaFimParam) : null;
modoLabelEl.textContent =
  "Modo: " +
  modo +
  (competenciasAlvo
    ? competenciasAlvo.length > 1
      ? " (competências " + competenciasAlvo[0] + " a " + competenciasAlvo[competenciasAlvo.length - 1] + ")"
      : " (competência " + competenciasAlvo[0] + ")"
    : "");

function log(msg, kind) {
  const line = document.createElement("div");
  line.className = kind ? "log-" + kind : "";
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log("[Radar e-Sfinge]", msg);
  pulsoCarga(msg);
}

// Com a carga já registrada como "em andamento", manda a etapa atual pro banco
// no máximo a cada 15s: se a aba travar, for fechada ou descartada pelo Chrome,
// o Controle de Cargas mostra até onde ela chegou.
let cargaAberta = false;
let ultimoPulso = 0;
function pulsoCarga(msg) {
  if (!cargaAberta || Date.now() - ultimoPulso < 15000) return;
  ultimoPulso = Date.now();
  updateDoc(cargaRef, { etapa: msg, pulso_em: serverTimestamp() }).catch(function () {});
}

// Resultado da carga agendada no histórico de disparos do painel — inclusive
// falha antes do login, que não consegue gravar nada no banco.
async function registrarNoLogAgenda(resultado) {
  if (modo !== "alarme") return;
  const { agenda_log: registro = [] } = await chrome.storage.local.get("agenda_log");
  registro.unshift({ em: Date.now(), horarios: ["carga"], resultado: resultado });
  await chrome.storage.local.set({ agenda_log: registro.slice(0, 30) });
}

// ── Alertas — o TCE muda os painéis sem aviso. Cada captura confere se o que
// veio ainda tem o formato esperado; o que sair do padrão vira um alerta, que
// vai pro log, pro registro da carga (Controle de Cargas), pro ícone da
// extensão ("!") e numa notificação do sistema no fim. ─────────────────────
const alertas = [];
// Ratificação e CND listam os 295 municípios; abaixo disso algo mudou.
const MIN_MUNICIPIOS = 280;

function alertar(fonte, mensagem) {
  if (alertas.some((a) => a.fonte === fonte && a.mensagem === mensagem)) return;
  alertas.push({ fonte: fonte, mensagem: mensagem });
  log("ALERTA — " + fonte + ": " + mensagem, "err");
}

async function avisarFimDaCarga(erro) {
  const problemas = alertas.length + (erro ? 1 : 0);
  try {
    await chrome.action.setBadgeText({ text: problemas ? "!" : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  } catch (e) {}
  const { last_execution: ultima } = await chrome.storage.local.get("last_execution");
  await chrome.storage.local.set({ last_execution: Object.assign({}, ultima, { alertas: alertas, erro: erro || null }) });
  if (!problemas) return;
  const primeira = erro ? "Carga com erro: " + erro : alertas[0].fonte + ": " + alertas[0].mensagem;
  const extras = problemas > 1 ? " (+" + (problemas - 1) + " alerta" + (problemas > 2 ? "s" : "") + " — veja o Controle de Cargas)" : "";
  try {
    chrome.notifications.create("carga-" + Date.now(), {
      type: "basic",
      iconUrl: "icon.png",
      title: "BI Esfinge SC — atenção na carga de dados",
      message: (primeira + extras).slice(0, 300),
      priority: 2,
      requireInteraction: true,
    });
  } catch (e) {}
}

function normalizar(nome) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ") // pontuação (apóstrofo, hífen...) vira espaço, nunca some
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

// Toda aba aberta pela carga fica registrada aqui e é fechada no fim (fecharAbasAbertas),
// mesmo quando uma etapa falha no meio e não chega no fecharAba dela.
const abasAbertas = new Set();

function abrirAbaOculta(url) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.create({ url: url, active: false }, function (tab) {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      abasAbertas.add(tab.id);
      // Sem isso o Chrome pode descartar a aba em segundo plano pra liberar memória e a captura morre no meio.
      chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(function () {});
      const limite = setTimeout(function () {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error("página não terminou de carregar em 60s: " + url));
      }, 60000);
      function onUpdated(tabId, info) {
        if (tabId === tab.id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          clearTimeout(limite);
          setTimeout(function () { resolve(tab); }, 2500); // settle: renderização Angular
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  });
}

function fecharAba(tab) {
  abasAbertas.delete(tab.id);
  return chrome.tabs.remove(tab.id).catch(function () {});
}

async function fecharAbasAbertas() {
  for (const id of abasAbertas) await chrome.tabs.remove(id).catch(function () {});
  abasAbertas.clear();
}

// ── Tentativas — o TCE falha de forma intermitente (ticket Qlik vazio, sessão
// WebSocket degradada que devolve poucas linhas). Cada etapa é repetida com
// espera crescente até dar certo, no máximo MAX_TENTATIVAS vezes.
// ponytail: limite fixo em vez de "até dar certo" pra uma queda longa do TCE
// não prender a carga pra sempre; aumentar aqui se 5 não bastar.
const MAX_TENTATIVAS = 5;

function esperar(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// Repete fn até valido(resultado) ou até acabar as tentativas. Sem sucesso,
// devolve o último resultado (ou relança o último erro, se a última falhou por erro).
async function comTentativas(rotulo, fn, valido) {
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const ultima = tentativa === MAX_TENTATIVAS;
    // Alertas de uma tentativa descartada não valem se a próxima der certo.
    const alertasAntes = alertas.length;
    try {
      const resultado = await fn();
      if (!valido || valido(resultado)) return resultado;
      if (!ultima) alertas.length = alertasAntes;
      if (ultima) {
        log(rotulo + ": ainda incompleto após " + MAX_TENTATIVAS + " tentativas — seguindo com o que veio.", "err");
        return resultado;
      }
      log(rotulo + ": resultado incompleto (tentativa " + tentativa + "/" + MAX_TENTATIVAS + ").", "err");
    } catch (err) {
      if (ultima) throw err;
      alertas.length = alertasAntes;
      log(rotulo + ": " + err.message + " (tentativa " + tentativa + "/" + MAX_TENTATIVAS + ").", "err");
    }
    await fecharAbasAbertas();
    const espera = 5 * tentativa;
    log("Tentando de novo em " + espera + "s...", "info");
    await esperar(espera * 1000);
  }
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

  if (porIbge.size < MIN_MUNICIPIOS) {
    alertar("CND", "só " + porIbge.size + " municípios lidos da consulta pública (" + result.length + " linhas" + (semMatch ? ", " + semMatch + " nomes sem correspondência" : "") + "; esperado ~295). A página pode ter mudado de layout.");
  }
  // O status só vira "irregular" se o texto da certidão contém "Falta de Dados";
  // se o TCE mudar esse texto, todo mundo passaria a "regular" sem erro nenhum.
  if (result.length > 0 && result.every((r) => r.status === "regular")) {
    alertar("CND", "todas as " + result.length + " certidões vieram como regular — o texto que indica irregularidade ('Falta de Dados') pode ter mudado no TCE.");
  }
  return porIbge;
}

// ── Componente 1b — Ratificações Globais (WebSocket, injetado numa aba na
// própria origem do Qlik — a mesma extração feita direto da página da extensão
// é rejeitada pelo servidor por causa do Origin chrome-extension://) ────────

// Autocontida: roda via chrome.scripting.executeScript dentro da aba, não pode
// fechar sobre nada do escopo externo (ver nota no topo do arquivo).
//
// Sempre recebe uma competenciaAlvo explícita ("MM/AAAA"). Primeiro acha o
// índice da coluna (eixo Mês/Ano) que bate com a competência pedida; se não
// existir ainda no painel, resolve lista vazia (não é erro — só significa que
// o TCE ainda não abriu aquela competência). Depois pagina o eixo dos
// municípios pedindo só aquela coluna.
function extractRatificacoesGlobais(competenciaAlvo) {
  return new Promise(function (resolve, reject) {
    var appId = "0e41d18b-45c4-4fef-94d4-ec0eee70fe5b";
    var objectId = "a76276a9-7638-4c81-96a6-b504100f7457";
    var ws = new WebSocket("wss://paineistransparencia.tce.sc.gov.br/app/" + appId);
    var msgId = 1;
    var ALTURA_PAGINA = 100;

    function call(method, handle, params) {
      return new Promise(function (res, rej) {
        var id = msgId++;
        function onMsg(e) {
          var d = JSON.parse(e.data);
          if (d.id !== id) return;
          ws.removeEventListener("message", onMsg);
          if (d.error) rej(new Error(JSON.stringify(d.error)));
          else res(d.result);
        }
        ws.addEventListener("message", onMsg);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, handle: handle, params: params }));
      });
    }

    // Cor da célula (qAttrExps) além do texto — mais confiável que tentar
    // adivinhar "no prazo"/"fora do prazo" só pela data. RGB(51,102,255) =
    // azul (no prazo), RGB(255,51,51) = vermelho (fora do prazo); qualquer
    // outra cor com data presente cai em "atrasado" (mais seguro que
    // "ausente", já que existe uma data real).
    // Sinais de que o TCE mudou o painel, devolvidos pra quem chamou avisar:
    // cor ou texto de célula fora do padrão conhecido, competência não encontrada.
    var coresDesconhecidas = {};
    var valoresInesperados = {};
    var colunaEncontrada = false;
    var colunasVistas = [];
    function classificar(valor, cor) {
      if (valor === "Ausente") return "ausente";
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) valoresInesperados[valor] = true;
      if (cor && cor.indexOf("51,102,255") >= 0) return "quitado";
      if (cor && cor.indexOf("255,51,51") >= 0) return "atrasado";
      coresDesconhecidas[cor || "sem cor"] = true;
      return "atrasado";
    }

    ws.onerror = function () {
      reject(new Error("Falha ao conectar no WebSocket do Qlik."));
    };
    // Horário da última recarga do painel no TCE — os dados só mudam quando ele recarrega.
    var recarga = null;
    ws.onopen = function () {
      call("OpenDoc", -1, [appId])
        .then(function (openDoc) {
          var docHandle = openDoc.qReturn.qHandle;
          return call("GetAppLayout", docHandle, [])
            .then(function (app) { recarga = (app.qLayout && app.qLayout.qLastReloadTime) || null; })
            .catch(function () {})
            .then(function () { return call("GetObject", docHandle, [objectId]); });
        })
        .then(function (getObj) {
          var objHandle = getObj.qReturn.qHandle;
          return call("GetLayout", objHandle, []).then(function (layoutRes) {
            var tamanho = layoutRes.qLayout.qHyperCube.qSize;
            var totalColunas = tamanho.qcx;
            var totalMunicipios = tamanho.qcy;
            return call("GetHyperCubePivotData", objHandle, ["/qHyperCubeDef", [{ qTop: 0, qLeft: 0, qWidth: totalColunas, qHeight: 1 }]]).then(
              function (pagina0) {
                var colunas = pagina0.qDataPages[0].qTop;
                colunasVistas = colunas.slice(-3).map(function (c) { return c.qText; });
                var colIndex = -1;
                for (var i = 0; i < colunas.length; i++) {
                  if (colunas[i].qText === competenciaAlvo) {
                    colIndex = i;
                    break;
                  }
                }
                if (colIndex < 0) return [];
                colunaEncontrada = true;

                var linhas = [];
                function buscarPagina(top) {
                  var altura = Math.min(ALTURA_PAGINA, totalMunicipios - top);
                  return call("GetHyperCubePivotData", objHandle, ["/qHyperCubeDef", [{ qTop: top, qLeft: colIndex, qWidth: 1, qHeight: altura }]]).then(
                    function (dataPage) {
                      var pg = dataPage.qDataPages[0];
                      pg.qLeft.forEach(function (municipioNo, i) {
                        var cell = pg.qData[i] && pg.qData[i][0];
                        if (!cell) return;
                        var valor = cell.qText;
                        var cor = cell.qAttrExps && cell.qAttrExps.qValues[0] && cell.qAttrExps.qValues[0].qText;
                        linhas.push({
                          nomeMunicipio: municipioNo.qText,
                          situacao: classificar(valor, cor),
                          data: valor === "Ausente" ? null : valor,
                        });
                      });
                      if (top + altura < totalMunicipios) return buscarPagina(top + altura);
                      return linhas;
                    }
                  );
                }
                return buscarPagina(0);
              }
            );
          });
        })
        .then(function (linhas) {
          ws.close();
          resolve({
            linhas: linhas,
            recarga: recarga,
            colunaEncontrada: colunaEncontrada,
            colunasVistas: colunasVistas,
            coresDesconhecidas: Object.keys(coresDesconhecidas),
            valoresInesperados: Object.keys(valoresInesperados).slice(0, 3),
          });
        })
        .catch(function (err) {
          ws.close();
          reject(err);
        });
    };
  });
}

// "MM/AAAA" do mês anterior ao atual — competência "corrente" por convenção
// do projeto (o mês em curso ainda não fechou pra fins de captura).
function competenciaMesAnterior() {
  const hoje = new Date();
  const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return String(mesAnterior.getMonth() + 1).padStart(2, "0") + "/" + mesAnterior.getFullYear();
}

async function capturarRatificacoes(porNomeBusca, competenciaAlvo) {
  const competencia = competenciaAlvo || competenciaMesAnterior();
  log("Abrindo Ratificações Globais para a competência " + competencia + "...");
  const tab = await abrirAbaOculta(RATIFICACOES_URL);
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractRatificacoesGlobais,
    args: [competencia],
  });
  await fecharAba(tab);
  const rows = result.linhas;
  log("Ratificações: " + rows.length + " linhas (competência " + competencia + ")" + (result.recarga ? " — painel do TCE atualizado em " + new Date(result.recarga).toLocaleString("pt-BR") : "") + ".");

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
      ratificacao_status: row.situacao,
      ratificacao_data_envio: row.data,
      ratificacao_atualizado_em: serverTimestamp(),
    });
  }
  log("Ratificações: " + porIbge.size + " municípios resolvidos" + (semMatch ? ", " + semMatch + " sem match" : "") + ".", "ok");

  if (!result.colunaEncontrada) {
    alertar("Ratificações", "a competência " + competencia + " não aparece no painel do TCE (últimas colunas vistas: " + result.colunasVistas.join(", ") + "). Se ela já deveria existir, o formato de Mês/Ano mudou.");
  } else if (porIbge.size < MIN_MUNICIPIOS) {
    alertar("Ratificações", "só " + porIbge.size + " municípios em " + competencia + " (esperado ~295)" + (semMatch ? "; " + semMatch + " nomes não bateram com o cadastro" : "") + ".");
  }
  if (result.coresDesconhecidas.length) {
    alertar("Ratificações", "cor de célula desconhecida no painel (" + result.coresDesconhecidas.join(", ") + ") — tratada como 'fora do prazo'. A legenda do TCE pode ter mudado.");
  }
  if (result.valoresInesperados.length) {
    alertar("Ratificações", "valor fora do padrão (data ou 'Ausente'): " + result.valoresInesperados.join(", ") + ".");
  }
  if (result.recarga) tceAtualizadoEm.ratificacoes = result.recarga;
  return { porIbge, competencia, recarga: result.recarga };
}

// ── Componente 2 — Status de Módulos por Área (restrito, precisa de login
// no TCE Virtual) — porte do fluxo login+ticket+WS Qlik já usado e testado
// na extensão extensao-esfinge, redirecionado para gravar no nosso Firestore
// em vez do backend Apps Script daquele projeto. ─────────────────────────

// Autocontidas: rodam via chrome.scripting.executeScript, não podem fechar
// sobre nada do escopo externo.

function readTokenFromPage() {
  var t = localStorage.getItem("token");
  if (!t) return null;
  try { t = JSON.parse(t); } catch (e) {}
  return t || null;
}

function isLoginPage() {
  return !!(
    document.querySelector("input[type=password]") ||
    document.body.innerText.includes("Matricula") ||
    document.body.innerText.includes("Fazer login")
  );
}

function fillLoginForm(matricula, senha) {
  function setVal(el, v) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    try { setter.call(el, v); } catch (e) { el.value = v; }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  var inputs = Array.from(document.querySelectorAll("input"));
  var userEl = inputs.find(function (i) { return i.type !== "password" && i.type !== "hidden" && i.type !== "submit"; });
  var passEl = inputs.find(function (i) { return i.type === "password"; });
  if (!userEl || !passEl) return "formulario-nao-encontrado";
  setVal(userEl, matricula);
  setVal(passEl, senha);
  var btn = document.querySelector("button[type=submit]") ||
    Array.from(document.querySelectorAll("button")).find(function (b) { return /entrar|login|ok|acessar/i.test(b.textContent); });
  if (btn) { btn.click(); return "ok"; }
  var form = document.querySelector("form");
  if (form) { form.submit(); return "ok"; }
  return "botao-nao-encontrado";
}

function callTicketQlik(token) {
  // Timeout explícito — sem ele, se a API do TCE não responder, a extensão
  // fica travada nessa etapa pra sempre (sem log de erro, sem "Concluído").
  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, 20000);
  return fetch("https://api.virtual.tce.sc.gov.br/sgi/rest/usuarios/ticketQlik", {
    method: "GET",
    headers: { auth_token: token },
    signal: controller.signal,
  })
    .then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("ticketQlik " + r.status + ": " + t.slice(0, 100)); });
      return r.text();
    })
    .then(function (body) {
      var match = body.match(/qlikTicket=([^&\s"']+)/);
      if (match) return match[1];
      try {
        var d = JSON.parse(body);
        var t = typeof d === "string" ? d : d.ticket || d.qlikTicket || d.token;
        if (t) return String(t);
      } catch (e) {}
      throw new Error("Nao foi possivel extrair ticket: " + body.slice(0, 100));
    })
    .catch(function (err) {
      if (err.name === "AbortError") throw new Error("ticketQlik: tempo esgotado (20s) sem resposta do TCE");
      throw err;
    })
    .finally(function () { clearTimeout(timeoutId); });
}

// periodo: "MM/AAAA". Retorna array de {municipio, anoMes, modulo, unidade, qtd, data_envio}
// ou {error}.
function extractQlikModulos(periodo) {
  return new Promise(function (resolve) {
    var appId = "7b7ba237-120c-4c65-9188-65334fc38245";
    var ws = new WebSocket("wss://paineis.tce.sc.gov.br/custom/app/" + appId);
    var msgId = 1, cubeHandle = null, docHandle = null, recarga = null, allRows = [], totalRows = 0;
    var PAGE_SIZE = 2000;
    var fase = "open";
    var timer = setTimeout(function () {
      try { ws.close(); } catch (e) {}
      resolve({ error: "Timeout — sessão Qlik expirou" });
    }, 120000);

    function send(msg) { ws.send(JSON.stringify(msg)); }

    ws.onopen = function () {
      send({ jsonrpc: "2.0", id: msgId++, method: "OpenDoc", handle: -1, params: [appId] });
    };
    ws.onerror = function () {
      clearTimeout(timer);
      resolve({ error: "Erro WebSocket — autenticação Qlik inválida" });
    };
    ws.onmessage = function (e) {
      var d = JSON.parse(e.data);
      if (d.method) return;

      if (fase === "open") {
        if (d.error || !d.result || !d.result.qReturn) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: (d.error && d.error.message) || "OpenDoc falhou" });
          return;
        }
        docHandle = d.result.qReturn.qHandle;
        // A sessão Qlik é a do usuário do login: uma seleção feita no painel
        // (ex.: um município) vale também aqui e filtra a extração inteira.
        // Limpa tudo antes, inclusive seleções travadas.
        fase = "clear";
        send({ jsonrpc: "2.0", id: msgId++, method: "ClearAll", handle: docHandle, params: [true] });
      } else if (fase === "clear") {
        fase = "reload";
        send({ jsonrpc: "2.0", id: msgId++, method: "GetAppLayout", handle: docHandle, params: [] });
      } else if (fase === "reload") {
        // Horário da última recarga do painel no TCE; se falhar, segue sem ele.
        recarga = (d.result && d.result.qLayout && d.result.qLayout.qLastReloadTime) || null;
        fase = "cube";
        send({
          jsonrpc: "2.0", id: msgId++, method: "CreateSessionObject", handle: docHandle,
          params: [{
            qInfo: { qType: "extract" },
            qHyperCubeDef: {
              qDimensions: [
                { qDef: { qFieldDefs: ["nomeEnte"] } },
                { qDef: { qFieldDefs: ["descricao"] } },
                { qDef: { qFieldDefs: ["nomeUnidade"], qNullSuppression: false } },
              ],
              qMeasures: [
                { qDef: { qDef: "Sum({<anoMesData={'" + periodo + "'}> } qtdPacotes)" } },
                { qDef: { qDef: "Date(Max({<anoMesData={'" + periodo + "'}> } datahorainiciotransmissao_original), 'DD/MM/YYYY')" } },
              ],
              qSuppressMissing: false,
              qInitialDataFetch: [{ qTop: 0, qLeft: 0, qHeight: 0, qWidth: 5 }],
            },
          }],
        });
      } else if (fase === "cube") {
        if (d.error || !d.result || !d.result.qReturn) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: (d.error && d.error.message) || "CreateSessionObject falhou" });
          return;
        }
        cubeHandle = d.result.qReturn.qHandle;
        fase = "layout";
        send({ jsonrpc: "2.0", id: msgId++, method: "GetLayout", handle: cubeHandle, params: [] });
      } else if (fase === "layout") {
        if (d.error || !d.result || !d.result.qLayout) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: (d.error && d.error.message) || "GetLayout falhou" });
          return;
        }
        var sz = d.result.qLayout.qHyperCube && d.result.qLayout.qHyperCube.qSize;
        if (!sz || sz.qcy === 0) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: "Sem dados para o período " + periodo });
          return;
        }
        totalRows = sz.qcy;
        fase = "fetch";
        fetchPage(0);
      } else if (fase === "fetch") {
        if (d.error || !d.result || !d.result.qDataPages) {
          clearTimeout(timer); try { ws.close(); } catch (ex) {}
          resolve({ error: (d.error && d.error.message) || "GetHyperCubeData falhou" });
          return;
        }
        var pg = d.result.qDataPages[0];
        if (pg && pg.qMatrix.length > 0) pg.qMatrix.forEach(function (r) { allRows.push(r); });
        if (allRows.length < totalRows) fetchPage(allRows.length);
        else finish();
      }
    };

    function fetchPage(top) {
      var h = Math.min(PAGE_SIZE, totalRows - top);
      send({ jsonrpc: "2.0", id: msgId++, method: "GetHyperCubeData", handle: cubeHandle, params: ["/qHyperCubeDef", [{ qTop: top, qLeft: 0, qHeight: h, qWidth: 5 }]] });
    }
    function finish() {
      clearTimeout(timer); try { ws.close(); } catch (ex) {}
      resolve({
        recarga: recarga,
        linhas: allRows.map(function (row) {
          var qtdNum = row[3] ? row[3].qNum || 0 : 0;
          return {
            municipio: (row[0].qText || "").trim(),
            anoMes: periodo,
            modulo: (row[1].qText || "").trim(),
            unidade: (row[2].qText || "").trim(),
            qtd: isNaN(qtdNum) ? 0 : qtdNum,
          };
        }),
      });
    }
  });
}

// ── Mapeamento nome de módulo (Qlik) → campo, e campo → área do Radar.
// "Contratos" não tem fonte identificada nesta extração — fica null,
// sinalizado no log em vez de adivinhado (ver plano, Estágio 7).
const MOD_SLUG = {
  "Assinatura Balancete do Razão": "assinatura_balancete_razao",
  "Execução Orçamentária": "execucao_orcamentaria",
  "Gestão Fiscal": "gestao_fiscal",
  "Planejamento": "planejamento",
  "Registros Contábeis": "registros_contabeis",
  "Relação Folha/Liquidação": "relacao_folha_liquidacao",
  "Relação Tributário/Contábil - Impostos": "relacao_tributario_impostos",
  "Relação Tributário/Contábil - Taxas": "relacao_tributario_taxas",
  "Situações de Obras/Serviços de Engenharia em Atraso": "situacoes_obras_engenharia",
  "Tributário": "tributario",
};
const AREA_POR_CAMPO = {
  assinatura_balancete_razao: "contabil",
  execucao_orcamentaria: "contabil",
  gestao_fiscal: "contabil",
  planejamento: "contabil",
  registros_contabeis: "contabil",
  relacao_folha_liquidacao: "folha",
  relacao_tributario_impostos: "tributos",
  relacao_tributario_taxas: "tributos",
  tributario: "tributos",
  // Não existe campo "Contratos" no Qlik do TCE — este é o mais próximo
  // (obras/serviços de engenharia em atraso), usado como proxy por pedido do usuário.
  situacoes_obras_engenharia: "contratos",
};
// somente/exceto: a quais tipos de entidade o campo se aplica; ok(v): valor
// válido; req: descrição legível da exigência, usada só pra explicar
// pendências em tela (não entra na lógica).
const REGRAS_MODULO = {
  assinatura_balancete_razao: { exceto: ["CI"], ok: (v) => v === 2, req: "exatamente 2 pacotes" },
  execucao_orcamentaria: { exceto: ["CI"], ok: (v) => v > 0, req: "ao menos 1 pacote" },
  gestao_fiscal: { somente: ["CM", "CI"], ok: (v) => v > 0, req: "ao menos 1 pacote" },
  planejamento: { somente: ["CI"], ok: (v) => v > 0, req: "ao menos 1 pacote" },
  registros_contabeis: { exceto: ["CI"], ok: (v) => v > 0, req: "ao menos 1 pacote" },
  relacao_folha_liquidacao: { exceto: ["CI", "Outros"], ok: (v) => v > 0, req: "ao menos 1 pacote" },
  relacao_tributario_impostos: { somente: ["Prefeitura"], ok: (v) => v > 0, req: "ao menos 1 pacote" },
  relacao_tributario_taxas: { somente: ["Prefeitura"], ok: (v) => v > 0, req: "ao menos 1 pacote" },
  tributario: { somente: ["Prefeitura"], ok: (v) => v > 0, req: "ao menos 1 pacote" },
  // Aplica a todas as entidades; "ok" aqui é 0 pendências (não ">0", o inverso dos outros campos).
  situacoes_obras_engenharia: { ok: (v) => v === 0, req: "0 obras/serviços em atraso" },
};

// slug de campo → nome legível (inverso de MOD_SLUG), pra explicar pendências.
const NOME_POR_CAMPO = Object.fromEntries(Object.entries(MOD_SLUG).map(([nome, slug]) => [slug, nome]));

// Módulo que o TCE devolve e não está em MOD_SLUG não entra em nenhuma área.
// Pode ser um módulo que nunca usamos de propósito, então avisa uma vez por nome
// (os já avisados ficam guardados neste navegador).
async function avisarModulosNovos(nomes) {
  if (nomes.size === 0) return;
  const { modulos_desconhecidos_vistos: vistos = [] } = await chrome.storage.local.get("modulos_desconhecidos_vistos");
  const novos = [...nomes].filter((n) => !vistos.includes(n));
  if (novos.length === 0) return;
  alertar("Módulos", "módulo novo no TCE, fora das regras: " + novos.join(", ") + ". Ele não entra em nenhuma área — se deve contar, precisa ser incluído nas regras (REGRAS_MODULO).");
  await chrome.storage.local.set({ modulos_desconhecidos_vistos: vistos.concat(novos) });
}

function detectarTipoEntidade(nomeUnidade) {
  const n = (nomeUnidade || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/CAMARA|C\.M\b|CM\b/.test(n)) return "CM";
  if (/CONTROLE.INTERNO|CONTROLADORIA/.test(n)) return "CI";
  if (/PREFEITURA/.test(n)) return "Prefeitura";
  if (/CONSORCIO|CONS\./.test(n)) return "Consorcio";
  return "Outros";
}

function campoAplica(campo, tipo) {
  const regra = REGRAS_MODULO[campo];
  if (regra.somente) return regra.somente.includes(tipo);
  if (regra.exceto) return !regra.exceto.includes(tipo);
  return true;
}

// Status de uma área para um documento de entidade: "ok" se todos os campos
// aplicáveis dessa área passam na regra; "pendente" se algum falhar/faltar;
// null se nenhum campo da área se aplica a esse tipo de entidade.
function statusArea(area, doc) {
  const campos = Object.keys(AREA_POR_CAMPO).filter((c) => AREA_POR_CAMPO[c] === area && campoAplica(c, doc.entidade));
  if (campos.length === 0) return null;
  const algumFalhou = campos.some((c) => {
    const v = doc[c];
    return v === null || v === undefined || !REGRAS_MODULO[c].ok(v);
  });
  return algumFalhou ? "pendente" : "ok";
}

const TIPO_ENTIDADE_LABEL = { CM: "Câmara", CI: "Controle Interno", Prefeitura: "Prefeitura", Consorcio: "Consórcio", Outros: "Outros" };

// Pendências de uma área cruzando TODAS as entidades (UGs) do município —
// cada item é um campo que falhou (ou nunca foi enviado) pra uma UG
// específica. Usado só pra explicar o "pendente" em tela, não decide status.
function pendenciasArea(area, entidades) {
  const pendencias = [];
  for (const doc of entidades) {
    const campos = Object.keys(AREA_POR_CAMPO).filter((c) => AREA_POR_CAMPO[c] === area && campoAplica(c, doc.entidade));
    for (const c of campos) {
      const v = doc[c];
      const ok = v !== null && v !== undefined && REGRAS_MODULO[c].ok(v);
      if (ok) continue;
      pendencias.push({
        campo: NOME_POR_CAMPO[c] || c,
        entidade: TIPO_ENTIDADE_LABEL[doc.entidade] || doc.entidade,
        valor: v === null || v === undefined ? null : v,
        requisito: REGRAS_MODULO[c].req || "",
      });
    }
  }
  return pendencias;
}

// Lê a lista de credenciais TCE salva pelo painel; aceita também o formato
// antigo (tce_matricula/tce_senha únicos), pra não quebrar quem ainda não
// reabriu o painel depois de atualizar a extensão.
async function obterCredenciaisTce() {
  const dados = await chrome.storage.local.get(["tce_credenciais", "tce_matricula", "tce_senha"]);
  if (dados.tce_credenciais && dados.tce_credenciais.length) return dados.tce_credenciais;
  if (dados.tce_matricula && dados.tce_senha) return [{ matricula: dados.tce_matricula, senha: dados.tce_senha }];
  return [];
}

// Login + ticket Qlik, usado por capturarModulos (única fonte que ainda
// precisa de login restrito — ratificação e sua data já são públicas).
// Tenta cada credencial da lista em sequência; se uma falhar no login, segue
// pra próxima na mesma aba (o formulário continua na tela após uma tentativa
// mal-sucedida, então só preenche de novo em cima).
async function obterTicketQlik() {
  const credenciais = await obterCredenciaisTce();
  if (credenciais.length === 0) {
    log("TCE Virtual: nenhuma credencial configurada — pulando captura restrita (módulos/datas).", "info");
    return null;
  }
  // Sem ticket a carga segue só sem módulos, em vez de perder CND/ratificação já capturadas.
  let ticket = null;
  try {
    ticket = await comTentativas("Ticket Qlik", () => tentarObterTicketQlik(credenciais), (t) => !!t);
  } catch (err) {
    log("Ticket Qlik: " + err.message, "err");
  }
  if (!ticket) {
    alertar("Login TCE", "não foi possível obter acesso ao painel restrito do TCE após " + MAX_TENTATIVAS + " tentativas — os módulos não foram atualizados nesta carga.");
  }
  return ticket;
}

async function tentarObterTicketQlik(credenciais) {
  log("Fazendo login no TCE Virtual...");
  const loginTab = await abrirAbaOculta(TCE_LOGIN_URL);

  for (let i = 0; i < credenciais.length; i++) {
    const { matricula, senha } = credenciais[i];
    const [{ result: precisaLogar }] = await chrome.scripting.executeScript({ target: { tabId: loginTab.id }, func: isLoginPage });
    if (precisaLogar) {
      const [{ result: preenchimento }] = await chrome.scripting.executeScript({
        target: { tabId: loginTab.id },
        func: fillLoginForm,
        args: [matricula, senha],
      });
      if (preenchimento !== "ok") {
        alertar("Login TCE", "a tela de login do TCE Virtual mudou (" + preenchimento + ") — a extensão não achou onde preencher matrícula/senha.");
      }
      await new Promise((r) => setTimeout(r, 3000));
      const [{ result: aindaLogin }] = await chrome.scripting.executeScript({ target: { tabId: loginTab.id }, func: isLoginPage });
      if (aindaLogin) {
        const ultima = i + 1 === credenciais.length;
        log("Login no TCE falhou para a matrícula " + matricula + (ultima ? "." : " — tentando a próxima credencial..."), "err");
        continue;
      }
    }

    log("Login no TCE confirmado (matrícula " + matricula + "). Obtendo ticket Qlik...", "ok");
    const [{ result: jwt }] = await chrome.scripting.executeScript({ target: { tabId: loginTab.id }, func: readTokenFromPage });
    if (!jwt) {
      await fecharAba(loginTab);
      log("Não foi possível ler o token de sessão do TCE.", "err");
      return null;
    }
    const [{ result: ticket }] = await chrome.scripting.executeScript({ target: { tabId: loginTab.id }, func: callTicketQlik, args: [jwt] });
    await fecharAba(loginTab);
    if (!ticket || typeof ticket !== "string") {
      log("Ticket Qlik inválido.", "err");
      return null;
    }
    return ticket;
  }

  await fecharAba(loginTab);
  log("Login no TCE falhou para todas as credenciais configuradas.", "err");
  return null;
}

async function capturarModulos(porNomeBusca, competenciaAlvo, ticket) {
  const vazio = { porIbge: new Map(), competencia: null };
  if (!ticket) return vazio;

  const periodo = competenciaAlvo || competenciaMesAnterior();

  log("Abrindo Qlik de módulos (período " + periodo + ")...");
  const qlikTab = await abrirAbaOculta(QLIK_MODULOS_URL + "?qlikTicket=" + ticket);
  let [{ result: rawData }] = await chrome.scripting.executeScript({
    target: { tabId: qlikTab.id },
    func: extractQlikModulos,
    args: [periodo],
  });
  await fecharAba(qlikTab);

  if (!rawData || rawData.error) {
    log("Módulos: " + (rawData ? rawData.error : "sem resposta do Qlik") + ".", "err");
    return vazio;
  }
  const recarga = rawData.recarga;
  rawData = rawData.linhas;
  log("Módulos: " + rawData.length + " linhas raspadas" + (recarga ? " — painel do TCE atualizado em " + new Date(recarga).toLocaleString("pt-BR") : "") + ".");

  // Pivotar em documentos por (município × entidade)
  const docsPorEntidade = new Map();
  const nomesDesconhecidos = new Set();
  let conhecidos = 0;
  for (const r of rawData) {
    if (!r.municipio || !r.modulo) continue;
    const tipo = detectarTipoEntidade(r.unidade && r.unidade !== "-" ? r.unidade : r.municipio);
    const chave = r.municipio + "||" + tipo;
    if (!docsPorEntidade.has(chave)) {
      docsPorEntidade.set(chave, { municipio: r.municipio, entidade: tipo });
    }
    const campo = MOD_SLUG[r.modulo];
    if (campo) {
      docsPorEntidade.get(chave)[campo] = r.qtd;
      conhecidos++;
    } else {
      nomesDesconhecidos.add(r.modulo);
    }
  }
  if (rawData.length > 0 && conhecidos === 0) {
    alertar("Módulos", "nenhum dos módulos conhecidos veio do TCE (" + [...nomesDesconhecidos].slice(0, 5).join(", ") + "…). Os nomes dos módulos mudaram — nenhuma área pode ser avaliada.");
  }

  // Agrupar por município: Prefeitura como representante, senão pior status entre entidades
  const porMunicipio = new Map();
  for (const entidadeDoc of docsPorEntidade.values()) {
    if (!porMunicipio.has(entidadeDoc.municipio)) porMunicipio.set(entidadeDoc.municipio, []);
    porMunicipio.get(entidadeDoc.municipio).push(entidadeDoc);
  }

  const porIbge = new Map();
  let semMatch = 0;
  const semMatchNomes = [];
  for (const [nomeMunicipio, entidades] of porMunicipio) {
    const municipio = resolverMunicipio(nomeMunicipio, porNomeBusca);
    if (!municipio) {
      semMatch++;
      semMatchNomes.push(nomeMunicipio);
      continue;
    }
    const prefeitura = entidades.find((d) => d.entidade === "Prefeitura");
    const modulos = {};
    for (const area of ["contabil", "folha", "tributos", "contratos"]) {
      let status;
      if (prefeitura) {
        status = statusArea(area, prefeitura);
      } else {
        const statusEntidades = entidades.map((d) => statusArea(area, d)).filter(Boolean);
        status = statusEntidades.includes("pendente") ? "pendente" : statusEntidades[0] || null;
      }
      modulos[area] = { status, pendencias: pendenciasArea(area, entidades), atualizado_em: serverTimestamp() };
    }
    porIbge.set(municipio.codigo_ibge, { modulos });
  }
  log("Módulos: " + porIbge.size + " municípios resolvidos" + (semMatch ? ", " + semMatch + " sem match" : "") + ".", "ok");
  // O painel de módulos lista também entes que não são municípios (consórcios,
  // associações etc.): não é município faltando — isso quem mostra é a cobertura.
  if (semMatch) {
    log(
      "Módulos: ignorados por não serem municípios do cadastro: " + semMatchNomes.slice(0, 10).join("; ") + (semMatch > 10 ? "; … (+" + (semMatch - 10) + ")" : "") + ".",
      "info"
    );
  }
  if (recarga) tceAtualizadoEm.modulos = recarga;
  return { porIbge, competencia: periodo, recarga, nomesDesconhecidos };
}

// ── Movimentações — diff entre o que já está no banco e o que acabou de ser
// capturado, gravado antes de sobrescrever. Só compara municípios presentes
// na captura nova: um município ausente (captura parcial/degradada) não vira
// "remoção" em massa. ─────────────────────────────────────────────────────

// Um doc de carga por execução desta página; o id já existe desde o início
// pra que cada movimentação aponte pra carga que a gerou.
const cargaRef = doc(collection(db, "cargas"));
let totalMovimentacoes = 0;
// Última recarga de cada painel do TCE vista nesta carga — explica um "0
// movimentações": se o TCE não recarregou desde a carga anterior, não há o que mudar.
const tceAtualizadoEm = { ratificacoes: null, modulos: null };

function statusModulo(area) {
  return function (d) {
    if (!d.modulos) return undefined;
    return d.modulos[area] ? d.modulos[area].status || null : null;
  };
}

const CAMPOS_RASTREADOS = [
  {
    fonte: "ratificacao",
    campo: "Ratificação Geral",
    ler: (d) => (d.ratificacao_status === undefined ? undefined : d.ratificacao_status || null),
    detalhe: (d) => d.ratificacao_data_envio || null,
    enviado: (v) => v === "quitado" || v === "atrasado",
  },
  { fonte: "modulo", campo: "Contábil", ler: statusModulo("contabil"), enviado: (v) => v === "ok" },
  { fonte: "modulo", campo: "Folha", ler: statusModulo("folha"), enviado: (v) => v === "ok" },
  { fonte: "modulo", campo: "Contratos", ler: statusModulo("contratos"), enviado: (v) => v === "ok" },
  { fonte: "modulo", campo: "Tributos", ler: statusModulo("tributos"), enviado: (v) => v === "ok" },
  {
    fonte: "cnd",
    campo: "CND",
    ler: (d) => (d.cnd_status === undefined ? undefined : d.cnd_status || null),
    detalhe: (d) => d.cnd_validade || null,
    enviado: (v) => v === "regular",
  },
];

// "envio": não enviado → enviado (inclui o que ainda não existia no banco);
// "remocao": enviado → não enviado (ex.: ratificou e depois removeu);
// "alteracao": continua enviado, mas mudou o valor ou a data.
// Não enviado → não enviado (ex.: vazio → "ausente") não é movimentação.
function detectarMovimentacoes(anterior, novo, fontes) {
  const movimentos = [];
  for (const c of CAMPOS_RASTREADOS) {
    if (!fontes.includes(c.fonte)) continue;
    const valorNovo = c.ler(novo);
    if (valorNovo === undefined) continue;
    const lido = anterior ? c.ler(anterior) : undefined;
    const valorAnterior = lido === undefined ? null : lido;
    const detalheNovo = c.detalhe ? c.detalhe(novo) : null;
    const detalheAnterior = c.detalhe && anterior ? c.detalhe(anterior) : null;
    const enviadoAntes = valorAnterior !== null && c.enviado(valorAnterior);
    const enviadoAgora = valorNovo !== null && c.enviado(valorNovo);
    let tipo = null;
    if (!enviadoAntes && enviadoAgora) tipo = "envio";
    else if (enviadoAntes && !enviadoAgora) tipo = "remocao";
    else if (enviadoAntes && enviadoAgora && (valorAnterior !== valorNovo || detalheAnterior !== detalheNovo)) tipo = "alteracao";
    if (!tipo) continue;
    movimentos.push({
      fonte: c.fonte,
      campo: c.campo,
      tipo: tipo,
      valor_anterior: valorAnterior,
      valor_novo: valorNovo,
      detalhe_anterior: detalheAnterior,
      detalhe_novo: detalheNovo,
    });
  }
  if (fontes.includes("modulo")) movimentos.push(...detectarMovimentacoesItens(anterior, novo));
  return movimentos;
}

const ROTULO_AREA = { contabil: "Contábil", folha: "Folha", contratos: "Contratos", tributos: "Tributos" };

// Pendências de uma área agrupadas por "campo (entidade)". A mesma entidade
// pode aparecer mais de uma vez no município (ex.: dois "Outros"), por isso
// guarda a lista de valores ordenada em vez de um valor só.
function pendenciasPorItem(area) {
  const porItem = new Map();
  for (const p of area.pendencias) {
    const chave = p.campo + " (" + p.entidade + ")";
    if (!porItem.has(chave)) porItem.set(chave, { valores: [], requisito: p.requisito || null });
    porItem.get(chave).valores.push(p.valor === null ? "não enviado" : String(p.valor));
  }
  for (const item of porItem.values()) item.valores.sort();
  return porItem;
}

// Item a item dentro de cada área: um item que sai da lista de pendências foi
// enviado; um que entra deixou de estar ok; um que continua pendente com outra
// quantidade mudou. Pega o envio parcial que não muda o status da área.
function detectarMovimentacoesItens(anterior, novo) {
  const movimentos = [];
  if (!anterior || !anterior.modulos || !novo.modulos) return movimentos;
  for (const area of Object.keys(ROTULO_AREA)) {
    const antes = anterior.modulos[area];
    const agora = novo.modulos[area];
    // Doc gravado antes de existir o detalhe de pendências: sem base pra comparar.
    if (!antes || !agora || !Array.isArray(antes.pendencias) || !Array.isArray(agora.pendencias)) continue;
    const itensAntes = pendenciasPorItem(antes);
    const itensAgora = pendenciasPorItem(agora);
    for (const chave of new Set([...itensAntes.keys(), ...itensAgora.keys()])) {
      const a = itensAntes.get(chave);
      const n = itensAgora.get(chave);
      const valorAnterior = a ? a.valores.join(", ") : "ok";
      const valorNovo = n ? n.valores.join(", ") : "ok";
      if (valorAnterior === valorNovo) continue;
      movimentos.push({
        fonte: "modulo_item",
        campo: ROTULO_AREA[area],
        item: chave,
        requisito: (n || a).requisito,
        tipo: !n ? "envio" : !a ? "remocao" : "alteracao",
        valor_anterior: valorAnterior,
        valor_novo: valorNovo,
        detalhe_anterior: null,
        detalhe_novo: null,
      });
    }
  }
  return movimentos;
}

// writeBatch aceita no máximo 500 operações — a 1ª captura de uma competência
// pode gerar mais que isso (295 municípios × 5 campos).
async function gravarMovimentacoes(movimentos) {
  if (movimentos.length === 0) return;
  for (let i = 0; i < movimentos.length; i += 400) {
    const batch = writeBatch(db);
    for (const m of movimentos.slice(i, i + 400)) {
      batch.set(doc(collection(db, "movimentacoes")), Object.assign({ carga_id: cargaRef.id, criado_em: serverTimestamp() }, m));
    }
    await batch.commit();
  }
  totalMovimentacoes += movimentos.length;
  log(movimentos.length + " movimentações registradas.", "ok");
}

function coletarMovimentacoes(porIbge, anterioresPorIbge, porIbgeMunicipios, competencia, fontes) {
  const movimentos = [];
  for (const [codigoIbge, campos] of porIbge) {
    const municipio = porIbgeMunicipios.get(codigoIbge);
    for (const m of detectarMovimentacoes(anterioresPorIbge.get(codigoIbge), campos, fontes)) {
      movimentos.push(Object.assign({ codigo_ibge: codigoIbge, municipio: municipio ? municipio.nome : "", competencia: competencia }, m));
    }
  }
  return movimentos;
}

// ── Gravação combinada no Firestore ──────────────────────────────────────

async function gravarStatusOperacional(porIbge, porIbgeMunicipios) {
  if (porIbge.size === 0) {
    log("Nada para gravar.");
    return 0;
  }
  // Ratificação/módulos são comparados por competência (gravarStatusPorCompetencia);
  // aqui só a CND, que não tem competência.
  const snapAnterior = await getDocs(collection(db, "status_operacional_atual"));
  const anteriores = new Map(snapAnterior.docs.map((d) => [d.id, d.data()]));
  await gravarMovimentacoes(coletarMovimentacoes(porIbge, anteriores, porIbgeMunicipios, null, ["cnd"]));

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

function competenciaParaId(competencia) {
  const [mes, ano] = competencia.split("/");
  return ano + "-" + mes;
}

async function gravarStatusPorCompetencia(competencia, porIbge, porIbgeMunicipios) {
  if (!competencia || porIbge.size === 0) return 0;
  const idCompetencia = competenciaParaId(competencia);

  const snapAnterior = await getDocs(query(collection(db, "status_por_competencia"), where("competencia", "==", competencia)));
  const anteriores = new Map(snapAnterior.docs.map((d) => [d.data().codigo_ibge, d.data()]));
  await gravarMovimentacoes(coletarMovimentacoes(porIbge, anteriores, porIbgeMunicipios, competencia, ["ratificacao", "modulo"]));

  const batch = writeBatch(db);
  for (const [codigoIbge, campos] of porIbge) {
    const municipio = porIbgeMunicipios.get(codigoIbge);
    batch.set(
      doc(db, "status_por_competencia", idCompetencia + "_" + codigoIbge),
      Object.assign(
        { codigo_ibge: codigoIbge, municipio: municipio ? municipio.nome : "", competencia: competencia, atualizado_em: serverTimestamp() },
        campos
      ),
      { merge: true }
    );
  }
  await batch.commit();
  log("Gravados " + porIbge.size + " documentos em status_por_competencia (" + competencia + ").", "ok");
  return porIbge.size;
}

function mesclarMapas(a, b) {
  const resultado = new Map(a);
  for (const [ibge, campos] of b) {
    resultado.set(ibge, Object.assign({}, resultado.get(ibge) || {}, campos));
  }
  return resultado;
}

// ── Componente 3 — snapshot diário ───────────────────────────────────────

async function gravarSnapshotsDiarios() {
  const snap = await getDocs(collection(db, "status_operacional_atual"));
  // ponytail: UTC, pode ficar 1 dia adiantado/atrasado perto da meia-noite em
  // America/Sao_Paulo. Upgrade: Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'})
  const hoje = new Date().toISOString().slice(0, 10);
  const batch = writeBatch(db);
  let total = 0;
  snap.forEach(function (d) {
    batch.set(
      doc(db, "snapshots_diarios", hoje + "_" + d.id),
      Object.assign({}, d.data(), { data: hoje, timestamp_execucao: serverTimestamp() })
    );
    total++;
  });
  await batch.commit();
  log("Snapshot diário gravado: " + total + " municípios (" + hoje + ").", "ok");
  return total;
}

// ── Orquestração ──────────────────────────────────────────────────────

// Um doc por execução em "cargas" — histórico rastreável de cada sincronização
// (hora, quem rodou, quantidade gravada), pra dar visibilidade no app web de
// que uma carga rodou e o que ela de fato gravou no Firestore.
// Cobertura por competência: quantos dos municípios do cadastro vieram em cada
// fonte, e quais faltaram — responde "percorreu todos os 295?" sem fazer conta.
const cobertura = [];

function registrarCobertura(competencia, ratif, modulos, municipiosPorIbge) {
  const total = municipiosPorIbge.size;
  const faltando = (mapa) =>
    [...municipiosPorIbge.keys()].filter((ibge) => !mapa.has(ibge)).map((ibge) => municipiosPorIbge.get(ibge).nome);
  const faltaRatif = faltando(ratif.porIbge);
  // Sem credencial/ticket do TCE os módulos nem foram buscados: null, não "0 de 295".
  const faltaModulos = modulos.semTicket ? null : faltando(modulos.porIbge);
  const item = {
    competencia: competencia,
    total: total,
    ratificacoes: ratif.porIbge.size,
    modulos: modulos.semTicket ? null : modulos.porIbge.size,
    faltando_ratificacao: faltaRatif.slice(0, 20),
    faltando_modulos: faltaModulos ? faltaModulos.slice(0, 20) : [],
  };
  cobertura.push(item);
  const completo = faltaRatif.length === 0 && faltaModulos !== null && faltaModulos.length === 0;
  const faltas = [];
  if (faltaRatif.length) faltas.push("ratificação sem " + faltaRatif.slice(0, 5).join(", ") + (faltaRatif.length > 5 ? "…" : ""));
  if (faltaModulos && faltaModulos.length) faltas.push("módulos sem " + faltaModulos.slice(0, 5).join(", ") + (faltaModulos.length > 5 ? "…" : ""));
  if (faltaModulos === null) faltas.push("módulos não buscados (sem acesso ao TCE)");
  log(
    "Cobertura " + competencia + ": ratificação " + item.ratificacoes + "/" + total + ", módulos " +
      (item.modulos === null ? "—" : item.modulos + "/" + total) +
      (completo ? " — todos os municípios percorridos." : " — " + faltas.join("; ") + "."),
    completo ? "ok" : "err"
  );
}

function resumoCobertura() {
  if (!cobertura.length) return "";
  const completas = cobertura.filter((c) => c.ratificacoes === c.total && c.modulos === c.total);
  if (completas.length === cobertura.length) {
    return " — " + (cobertura.length > 1 ? "todas as " + cobertura.length + " competências" : "competência " + cobertura[0].competencia) + " com " + cobertura[0].total + "/" + cobertura[0].total + " municípios";
  }
  return " — incompleto em " + cobertura.filter((c) => !completas.includes(c)).map((c) => c.competencia).join(", ");
}

async function registrarCarga(campos) {
  cargaAberta = false;
  try {
    await setDoc(cargaRef, Object.assign({ concluido_em: serverTimestamp(), tce_atualizado_em: tceAtualizadoEm, alertas: alertas, modo: modo, cobertura: cobertura }, campos));
  } catch (err) {
    log("Não foi possível registrar a carga em 'cargas': " + err.message, "err");
  }
}

async function main() {
  const inicioMs = Date.now();
  let userEmail = null;
  let erroCarga = null;
  let tipoCarga = competenciasAlvo ? "backfill" : "sync";
  let periodoCarga = competenciasAlvo
    ? competenciasAlvo.length > 1
      ? competenciasAlvo[0] + " a " + competenciasAlvo[competenciasAlvo.length - 1]
      : competenciasAlvo[0]
    : null;

  try {
    const user = await signInComContaBetha();
    userEmail = user.email;

    if (modo === "login") {
      log("Login concluído. Pode fechar esta aba.", "ok");
      return;
    }

    // Sinaliza pro agendamento (background.js) não abrir outra carga por cima desta.
    await chrome.storage.local.set({ carga_em_andamento: Date.now() });
    chrome.tabs.getCurrent(function (aba) {
      if (aba) chrome.tabs.update(aba.id, { autoDiscardable: false }).catch(function () {});
    });
    // Registra a carga já no início; o registro final (registrarCarga) substitui este.
    try {
      await setDoc(cargaRef, {
        status: "em_andamento",
        tipo: tipoCarga,
        periodo: periodoCarga,
        usuario: userEmail,
        modo: modo,
        iniciado_em: new Date(inicioMs),
        concluido_em: null,
        etapa: "Iniciando",
        pulso_em: serverTimestamp(),
      });
      cargaAberta = true;
    } catch (err) {
      log("Não foi possível registrar o início da carga: " + err.message, "err");
    }
    const { porNomeBusca, porIbge: municipiosPorIbge } = await carregarMunicipios();

    if (competenciasAlvo) {
      // Backfill de um período de competências: acumula histórico em
      // status_por_competencia, uma competência de cada vez. Se o período inclui a
      // competência vigente (mês anterior), também atualiza o que a sincronização
      // normal atualiza (CND, estado atual e foto do dia) — senão essas partes
      // ficavam paradas pra quem só usa o backfill.
      const vigente = competenciaMesAnterior();
      let ratifVigente = null;
      let modulosVigente = null;
      let totalRatifSoma = 0;
      let totalModulosSoma = 0;
      for (const competenciaAlvo of competenciasAlvo) {
        const ratif = await comTentativas("Ratificações " + competenciaAlvo, () => capturarRatificacoes(porNomeBusca, competenciaAlvo));
        const modulos = await capturarModulosComTentativas(porNomeBusca, competenciaAlvo);
        totalRatifSoma += await gravarStatusPorCompetencia(ratif.competencia, ratif.porIbge, municipiosPorIbge);
        totalModulosSoma += await gravarStatusPorCompetencia(modulos.competencia, modulos.porIbge, municipiosPorIbge);
        registrarCobertura(competenciaAlvo, ratif, modulos, municipiosPorIbge);
        if (competenciaAlvo === vigente) {
          ratifVigente = ratif;
          modulosVigente = modulos;
        }
      }

      let estado = null;
      if (ratifVigente) {
        log("Período inclui a competência vigente (" + vigente + ") — atualizando estado atual, CND e foto do dia...");
        estado = await atualizarEstadoAtual(ratifVigente, modulosVigente, porNomeBusca, municipiosPorIbge);
      }

      await chrome.storage.local.set({
        last_execution: {
          resumo:
            "Backfill " + periodoCarga + ": " + totalRatifSoma + " ratificações, " + totalModulosSoma + " módulos" +
            (estado ? ", estado atual e CND atualizados" : "") + resumoCobertura(),
          timestamp: Date.now(),
        },
      });
      await registrarCarga({
        tipo: tipoCarga,
        periodo: periodoCarga,
        usuario: userEmail,
        iniciado_em: new Date(inicioMs),
        duracao_ms: Date.now() - inicioMs,
        status: "sucesso",
        erro: null,
        totais: Object.assign(
          { ratificacoes: totalRatifSoma, modulos: totalModulosSoma, movimentacoes: totalMovimentacoes },
          estado
        ),
      });
      log("Concluído.", "ok");
      fecharEstaAba();
      return;
    }

    const ratif = await comTentativas("Ratificações", () => capturarRatificacoes(porNomeBusca));
    const modulos = await capturarModulosComTentativas(porNomeBusca, undefined);
    periodoCarga = ratif.competencia || modulos.competencia || null;
    const estado = await atualizarEstadoAtual(ratif, modulos, porNomeBusca, municipiosPorIbge);
    // Acumula a competência "atual" de cada fonte no histórico também, pra ir
    // formando a série de status_por_competencia sem precisar de backfill manual.
    await gravarStatusPorCompetencia(ratif.competencia, ratif.porIbge, municipiosPorIbge);
    await gravarStatusPorCompetencia(modulos.competencia, modulos.porIbge, municipiosPorIbge);
    registrarCobertura(ratif.competencia, ratif, modulos, municipiosPorIbge);

    await chrome.storage.local.set({
      last_execution: {
        resumo: estado.status_operacional + " municípios atualizados, " + estado.snapshot + " snapshots gravados" + resumoCobertura(),
        timestamp: Date.now(),
      },
    });
    await registrarCarga({
      tipo: tipoCarga,
      periodo: periodoCarga,
      usuario: userEmail,
      iniciado_em: new Date(inicioMs),
      duracao_ms: Date.now() - inicioMs,
      status: "sucesso",
      erro: null,
      totais: Object.assign(
        { ratificacoes: ratif.porIbge.size, modulos: modulos.porIbge.size, movimentacoes: totalMovimentacoes },
        estado
      ),
    });

    log("Concluído.", "ok");
    fecharEstaAba();
  } catch (err) {
    erroCarga = err.message;
    log("Erro: " + err.message, "err");
    await chrome.storage.local.set({ last_execution: { resumo: "Erro: " + err.message, timestamp: Date.now() } });
    await registrarCarga({
      tipo: tipoCarga,
      periodo: periodoCarga,
      usuario: userEmail,
      iniciado_em: new Date(inicioMs),
      duracao_ms: Date.now() - inicioMs,
      status: "erro",
      erro: err.message,
      totais: totalMovimentacoes ? { movimentacoes: totalMovimentacoes } : null,
    });
  } finally {
    await registrarNoLogAgenda(erroCarga ? "falhou: " + erroCarga : "concluída");
    await chrome.storage.local.remove("carga_em_andamento");
    await fecharAbasAbertas();
    if (modo !== "login") await avisarFimDaCarga(erroCarga);
  }
}

// O que vai além do histórico por competência: CND, estado atual
// (status_operacional_atual) e a foto do dia (snapshots_diarios, base da Evolução).
// Usado pela sincronização normal e pelo backfill que inclui a competência vigente.
async function atualizarEstadoAtual(ratif, modulos, porNomeBusca, municipiosPorIbge) {
  const cndPorIbge = await comTentativas("CND", () => capturarCND(porNomeBusca), (m) => m.size >= MIN_MUNICIPIOS);
  const combinado = mesclarMapas(mesclarMapas(cndPorIbge, ratif.porIbge), modulos.porIbge);
  const statusOperacional = await gravarStatusOperacional(combinado, municipiosPorIbge);
  const snapshot = await gravarSnapshotsDiarios();
  return { cnd: cndPorIbge.size, status_operacional: statusOperacional, snapshot: snapshot };
}

// Uma captura de módulos boa resolve quase todos os 295 municípios (~290); a
// sessão degradada do Qlik devolve 1 ou poucos.
// ponytail: limiar fixo; baixar se o TCE passar a trazer menos municípios de verdade.
const MIN_MUNICIPIOS_MODULOS = 200;

// Ticket novo a cada tentativa: é de uso único, e reaproveitá-lo fazia a sessão
// cair degradada ou falhar no GetHyperCubeData.
async function capturarModulosComTentativas(porNomeBusca, competenciaAlvo) {
  const periodo = competenciaAlvo || competenciaMesAnterior();
  const r = await comTentativas(
    "Módulos " + periodo,
    async () => {
      const ticket = await obterTicketQlik();
      if (!ticket) return { porIbge: new Map(), competencia: null, semTicket: true };
      return capturarModulos(porNomeBusca, competenciaAlvo, ticket);
    },
    (res) => res.semTicket || res.porIbge.size >= MIN_MUNICIPIOS_MODULOS
  );
  // Só depois da tentativa que valeu, pra não marcar como "já avisado" um nome visto numa tentativa descartada.
  if (r.nomesDesconhecidos) await avisarModulosNovos(r.nomesDesconhecidos);
  if (!r.semTicket && r.porIbge.size < MIN_MUNICIPIOS_MODULOS) {
    alertar("Módulos", "só " + r.porIbge.size + " municípios em " + periodo + " após " + MAX_TENTATIVAS + " tentativas (esperado ~295) — os módulos dessa competência ficaram incompletos.");
  }
  return r;
}

// Carga terminou bem: fecha a própria aba do log (o resultado fica no Controle
// de Cargas). Com erro a aba fica aberta pra dar pra ler o que houve.
function fecharEstaAba() {
  const segundos = modo === "alarme" ? 2 : 10;
  log("Esta aba fecha sozinha em " + segundos + "s.", "info");
  setTimeout(function () {
    chrome.tabs.getCurrent(function (tab) {
      if (tab) chrome.tabs.remove(tab.id);
      else window.close();
    });
  }, segundos * 1000);
}

main();
