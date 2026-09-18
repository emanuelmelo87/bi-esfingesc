import { signInWithCredential, GoogleAuthProvider, signOut } from "firebase/auth";
import { collection, getDocs, doc, writeBatch, serverTimestamp } from "firebase/firestore";
import { auth, db, ALLOWED_EMAIL_DOMAIN } from "./firebase-config.js";

const CND_URL =
  "https://virtual.tce.sc.gov.br/esfinge-web/esfinge-online/administracao/certidao/consulta-geral";
const RATIFICACOES_URL =
  "https://paineistransparencia.tce.sc.gov.br/extensions/appRatificacoesGlobais/index.html";
// appId "0e41d18b-45c4-4fef-94d4-ec0eee70fe5b", objeto "WMFemM" (Ano/Mês, Ranking, Nome
// Municipio, Situação) — hardcoded dentro de extractRatificacoesGlobais, que roda injetada
// numa aba e não pode fechar sobre constantes deste escopo.

const TCE_LOGIN_URL = "https://virtual.tce.sc.gov.br/login";
const TCE_TICKET_API = "https://api.virtual.tce.sc.gov.br/sgi/rest/usuarios/ticketQlik";
const QLIK_MODULOS_URL = "https://paineis.tce.sc.gov.br/custom/extensions/ExtratosEsfinge/index.html";

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
function extractRatificacoesGlobais() {
  return new Promise(function (resolve, reject) {
    var appId = "0e41d18b-45c4-4fef-94d4-ec0eee70fe5b";
    var objectId = "WMFemM";
    var ws = new WebSocket("wss://paineistransparencia.tce.sc.gov.br/app/" + appId);
    var msgId = 1;

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

    ws.onerror = function () {
      reject(new Error("Falha ao conectar no WebSocket do Qlik."));
    };
    ws.onopen = function () {
      call("OpenDoc", -1, [appId])
        .then(function (openDoc) {
          return call("GetObject", openDoc.qReturn.qHandle, [objectId]);
        })
        .then(function (getObj) {
          return call("GetHyperCubeData", getObj.qReturn.qHandle, [
            "/qHyperCubeDef",
            [{ qTop: 0, qLeft: 0, qHeight: 295, qWidth: 4 }],
          ]);
        })
        .then(function (dataPage) {
          ws.close();
          resolve(
            dataPage.qDataPages[0].qMatrix.map(function (r) {
              return { anoMes: r[0].qText, nomeMunicipio: r[2].qText, situacao: r[3].qText };
            })
          );
        })
        .catch(function (err) {
          ws.close();
          reject(err);
        });
    };
  });
}

function mapSituacao(situacaoTexto) {
  if (situacaoTexto.indexOf("No Prazo") >= 0) return "quitado";
  if (situacaoTexto.indexOf("Fora do Prazo") >= 0) return "atrasado";
  return "ausente";
}

async function capturarRatificacoes(porNomeBusca) {
  log("Abrindo Ratificações Globais em aba oculta...");
  const tab = await abrirAbaOculta(RATIFICACOES_URL);
  const [{ result: rows }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractRatificacoesGlobais,
  });
  await fecharAba(tab);
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
// somente/exceto: a quais tipos de entidade o campo se aplica; ok(v): valor válido.
const REGRAS_MODULO = {
  assinatura_balancete_razao: { exceto: ["CI"], ok: (v) => v === 2 },
  execucao_orcamentaria: { exceto: ["CI"], ok: (v) => v > 0 },
  gestao_fiscal: { somente: ["CM", "CI"], ok: (v) => v > 0 },
  planejamento: { somente: ["CI"], ok: (v) => v > 0 },
  registros_contabeis: { exceto: ["CI"], ok: (v) => v > 0 },
  relacao_folha_liquidacao: { exceto: ["CI", "Outros"], ok: (v) => v > 0 },
  relacao_tributario_impostos: { somente: ["Prefeitura"], ok: (v) => v > 0 },
  relacao_tributario_taxas: { somente: ["Prefeitura"], ok: (v) => v > 0 },
  tributario: { somente: ["Prefeitura"], ok: (v) => v > 0 },
  // Aplica a todas as entidades; "ok" aqui é 0 pendências (não ">0", o inverso dos outros campos).
  situacoes_obras_engenharia: { ok: (v) => v === 0 },
};

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

async function capturarModulos(porNomeBusca) {
  const { tce_matricula, tce_senha } = await chrome.storage.local.get(["tce_matricula", "tce_senha"]);
  if (!tce_matricula || !tce_senha) {
    log("Módulos por área: credenciais do TCE não configuradas — pulando.", "info");
    return new Map();
  }

  log("Fazendo login no TCE Virtual...");
  const loginTab = await abrirAbaOculta(TCE_LOGIN_URL);
  const [{ result: precisaLogar }] = await chrome.scripting.executeScript({ target: { tabId: loginTab.id }, func: isLoginPage });
  if (precisaLogar) {
    await chrome.scripting.executeScript({
      target: { tabId: loginTab.id },
      func: fillLoginForm,
      args: [tce_matricula, tce_senha],
    });
    await new Promise((r) => setTimeout(r, 3000));
    const [{ result: aindaLogin }] = await chrome.scripting.executeScript({ target: { tabId: loginTab.id }, func: isLoginPage });
    if (aindaLogin) {
      await fecharAba(loginTab);
      log("Login no TCE falhou — verifique a matrícula/senha configuradas.", "err");
      return new Map();
    }
  }
  const [{ result: jwt }] = await chrome.scripting.executeScript({ target: { tabId: loginTab.id }, func: readTokenFromPage });
  if (!jwt) {
    await fecharAba(loginTab);
    log("Não foi possível ler o token de sessão do TCE.", "err");
    return new Map();
  }
  log("Login no TCE confirmado. Obtendo ticket Qlik...", "ok");
  const [{ result: ticket }] = await chrome.scripting.executeScript({ target: { tabId: loginTab.id }, func: callTicketQlik, args: [jwt] });
  await fecharAba(loginTab);

  if (!ticket || typeof ticket !== "string") {
    log("Ticket Qlik inválido.", "err");
    return new Map();
  }

  const hoje = new Date();
  const mesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const periodo = String(mesAnterior.getMonth() + 1).padStart(2, "0") + "/" + mesAnterior.getFullYear();

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
    return new Map();
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
      if (prefeitura) {
        modulos[area] = { status: statusArea(area, prefeitura), atualizado_em: serverTimestamp() };
      } else {
        const statusEntidades = entidades.map((d) => statusArea(area, d)).filter(Boolean);
        const pior = statusEntidades.includes("pendente") ? "pendente" : statusEntidades[0] || null;
        modulos[area] = { status: pior, atualizado_em: serverTimestamp() };
      }
    }
    porIbge.set(municipio.codigo_ibge, { modulos });
  }
  log("Módulos: " + porIbge.size + " municípios resolvidos" + (semMatch ? ", " + semMatch + " sem match" : "") + ".", "ok");
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
    const modulosPorIbge = await capturarModulos(porNomeBusca);
    const combinado = mesclarMapas(mesclarMapas(cndPorIbge, ratifPorIbge), modulosPorIbge);
    const total = await gravarStatusOperacional(combinado, municipiosPorIbge);
    const totalSnapshot = await gravarSnapshotsDiarios();

    await chrome.storage.local.set({
      last_execution: {
        resumo: total + " municípios atualizados, " + totalSnapshot + " snapshots gravados",
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
