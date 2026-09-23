import { signInWithCredential, GoogleAuthProvider, signOut } from "firebase/auth";
import { addDoc, collection, getDocs, doc, writeBatch, serverTimestamp } from "firebase/firestore";
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
    function classificar(valor, cor) {
      if (valor === "Ausente") return "ausente";
      if (cor && cor.indexOf("51,102,255") >= 0) return "quitado";
      if (cor && cor.indexOf("255,51,51") >= 0) return "atrasado";
      return "atrasado";
    }

    ws.onerror = function () {
      reject(new Error("Falha ao conectar no WebSocket do Qlik."));
    };
    ws.onopen = function () {
      call("OpenDoc", -1, [appId])
        .then(function (openDoc) {
          return call("GetObject", openDoc.qReturn.qHandle, [objectId]);
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
                var colIndex = -1;
                for (var i = 0; i < colunas.length; i++) {
                  if (colunas[i].qText === competenciaAlvo) {
                    colIndex = i;
                    break;
                  }
                }
                if (colIndex < 0) return [];

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
          resolve(linhas);
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
  const [{ result: rows }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractRatificacoesGlobais,
    args: [competencia],
  });
  await fecharAba(tab);
  log("Ratificações: " + rows.length + " linhas (competência " + competencia + ").");

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
  return { porIbge, competencia };
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
  return fetch("https://api.virtual.tce.sc.gov.br/sgi/rest/usuarios/ticketQlik", {
    method: "GET",
    headers: { auth_token: token },
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
    });
}

// periodo: "MM/AAAA". Retorna array de {municipio, anoMes, modulo, unidade, qtd, data_envio}
// ou {error}.
function extractQlikModulos(periodo) {
  return new Promise(function (resolve) {
    var appId = "7b7ba237-120c-4c65-9188-65334fc38245";
    var ws = new WebSocket("wss://paineis.tce.sc.gov.br/custom/app/" + appId);
    var msgId = 1, cubeHandle = null, allRows = [], totalRows = 0;
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
        var docHandle = d.result.qReturn.qHandle;
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
      resolve(allRows.map(function (row) {
        var qtdNum = row[3] ? row[3].qNum || 0 : 0;
        return {
          municipio: (row[0].qText || "").trim(),
          anoMes: periodo,
          modulo: (row[1].qText || "").trim(),
          unidade: (row[2].qText || "").trim(),
          qtd: isNaN(qtdNum) ? 0 : qtdNum,
        };
      }));
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

  log("Fazendo login no TCE Virtual...");
  const loginTab = await abrirAbaOculta(TCE_LOGIN_URL);

  for (let i = 0; i < credenciais.length; i++) {
    const { matricula, senha } = credenciais[i];
    const [{ result: precisaLogar }] = await chrome.scripting.executeScript({ target: { tabId: loginTab.id }, func: isLoginPage });
    if (precisaLogar) {
      await chrome.scripting.executeScript({
        target: { tabId: loginTab.id },
        func: fillLoginForm,
        args: [matricula, senha],
      });
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
  const [{ result: rawData }] = await chrome.scripting.executeScript({
    target: { tabId: qlikTab.id },
    func: extractQlikModulos,
    args: [periodo],
  });
  await fecharAba(qlikTab);

  if (!rawData || rawData.error) {
    log("Módulos: " + (rawData ? rawData.error : "sem resposta do Qlik") + ".", "err");
    return vazio;
  }
  log("Módulos: " + rawData.length + " linhas raspadas.");

  // Pivotar em documentos por (município × entidade)
  const docsPorEntidade = new Map();
  for (const r of rawData) {
    if (!r.municipio || !r.modulo) continue;
    const tipo = detectarTipoEntidade(r.unidade && r.unidade !== "-" ? r.unidade : r.municipio);
    const chave = r.municipio + "||" + tipo;
    if (!docsPorEntidade.has(chave)) {
      docsPorEntidade.set(chave, { municipio: r.municipio, entidade: tipo });
    }
    const campo = MOD_SLUG[r.modulo];
    if (campo) docsPorEntidade.get(chave)[campo] = r.qtd;
  }

  // Agrupar por município: Prefeitura como representante, senão pior status entre entidades
  const porMunicipio = new Map();
  for (const entidadeDoc of docsPorEntidade.values()) {
    if (!porMunicipio.has(entidadeDoc.municipio)) porMunicipio.set(entidadeDoc.municipio, []);
    porMunicipio.get(entidadeDoc.municipio).push(entidadeDoc);
  }

  const porIbge = new Map();
  let semMatch = 0;
  for (const [nomeMunicipio, entidades] of porMunicipio) {
    const municipio = resolverMunicipio(nomeMunicipio, porNomeBusca);
    if (!municipio) {
      semMatch++;
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
  return { porIbge, competencia: periodo };
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

function competenciaParaId(competencia) {
  const [mes, ano] = competencia.split("/");
  return ano + "-" + mes;
}

async function gravarStatusPorCompetencia(competencia, porIbge, porIbgeMunicipios) {
  if (!competencia || porIbge.size === 0) return 0;
  const idCompetencia = competenciaParaId(competencia);
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
async function registrarCarga(campos) {
  try {
    await addDoc(collection(db, "cargas"), Object.assign({ concluido_em: serverTimestamp() }, campos));
  } catch (err) {
    log("Não foi possível registrar a carga em 'cargas': " + err.message, "err");
  }
}

async function main() {
  const inicioMs = Date.now();
  let userEmail = null;
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

    const { porNomeBusca, porIbge: municipiosPorIbge } = await carregarMunicipios();

    if (competenciasAlvo) {
      // Backfill de um período de competências: não mexe em status_operacional_atual
      // nem em snapshots_diarios (que representam o "estado atual"), só acumula
      // histórico em status_por_competencia, uma competência de cada vez. CND não
      // entra — não tem esse conceito.
      // Ticket Qlik pedido de novo a cada competência (não reaproveitado do loop
      // inteiro): o ticket é de uso único — reaproveitá-lo entre várias sessões
      // WS sequenciais fazia as competências seguintes caírem numa sessão anônima/
      // degradada (poucas linhas) ou falhar de vez no GetHyperCubeData.
      let totalRatifSoma = 0;
      let totalModulosSoma = 0;
      for (const competenciaAlvo of competenciasAlvo) {
        const ratif = await capturarRatificacoes(porNomeBusca, competenciaAlvo);
        const ticketModulos = await obterTicketQlik();
        const modulos = await capturarModulos(porNomeBusca, competenciaAlvo, ticketModulos);
        totalRatifSoma += await gravarStatusPorCompetencia(ratif.competencia, ratif.porIbge, municipiosPorIbge);
        totalModulosSoma += await gravarStatusPorCompetencia(modulos.competencia, modulos.porIbge, municipiosPorIbge);
      }

      await chrome.storage.local.set({
        last_execution: {
          resumo: "Backfill " + periodoCarga + ": " + totalRatifSoma + " ratificações, " + totalModulosSoma + " módulos",
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
        totais: { ratificacoes: totalRatifSoma, modulos: totalModulosSoma },
      });
      log("Concluído.", "ok");
      if (modo === "alarme") setTimeout(function () { window.close(); }, 2000);
      return;
    }

    const cndPorIbge = await capturarCND(porNomeBusca);
    const ratif = await capturarRatificacoes(porNomeBusca);
    const ticket = await obterTicketQlik();
    const modulos = await capturarModulos(porNomeBusca, undefined, ticket);
    periodoCarga = ratif.competencia || modulos.competencia || null;
    const combinado = mesclarMapas(mesclarMapas(cndPorIbge, ratif.porIbge), modulos.porIbge);
    const total = await gravarStatusOperacional(combinado, municipiosPorIbge);
    const totalSnapshot = await gravarSnapshotsDiarios();
    // Acumula a competência "atual" de cada fonte no histórico também, pra ir
    // formando a série de status_por_competencia sem precisar de backfill manual.
    await gravarStatusPorCompetencia(ratif.competencia, ratif.porIbge, municipiosPorIbge);
    await gravarStatusPorCompetencia(modulos.competencia, modulos.porIbge, municipiosPorIbge);

    await chrome.storage.local.set({
      last_execution: {
        resumo: total + " municípios atualizados, " + totalSnapshot + " snapshots gravados",
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
      totais: { cnd: cndPorIbge.size, ratificacoes: ratif.porIbge.size, modulos: modulos.porIbge.size, status_operacional: total, snapshot: totalSnapshot },
    });

    log("Concluído.", "ok");
    if (modo === "alarme") setTimeout(function () { window.close(); }, 2000);
  } catch (err) {
    log("Erro: " + err.message, "err");
    await registrarCarga({
      tipo: tipoCarga,
      periodo: periodoCarga,
      usuario: userEmail,
      iniciado_em: new Date(inicioMs),
      duracao_ms: Date.now() - inicioMs,
      status: "erro",
      erro: err.message,
      totais: null,
    });
  }
}

main();
