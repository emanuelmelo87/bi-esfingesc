// Plataforma Chrome da carga: tudo que a extensão faz por ser extensão (abas,
// login Google, chrome.storage, badge e notificação). A lógica da carga em si
// fica em carga.js, compartilhada com a carga na nuvem (functions/).
import { signInWithCredential, GoogleAuthProvider, signOut } from "firebase/auth";
import { auth, db, ALLOWED_EMAIL_DOMAIN } from "./firebase-config.js";
import { executarCarga } from "./carga.js";

const logEl = document.getElementById("log");
const modoLabelEl = document.getElementById("modo-label");
const urlParams = new URLSearchParams(location.search);
const modo = urlParams.get("modo") || "manual";
// "competencia" sozinho ainda funciona (1 mês só), pra não quebrar um link/atalho antigo.
const competenciaInicioParam = urlParams.get("competencia_inicio") || urlParams.get("competencia") || null;
const competenciaFimParam = urlParams.get("competencia_fim") || competenciaInicioParam;

function log(msg, kind) {
  const line = document.createElement("div");
  line.className = kind ? "log-" + kind : "";
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  console.log("[Radar e-Sfinge]", msg);
}

// Resultado da carga agendada no histórico de disparos do painel — inclusive
// falha antes do login, que não consegue gravar nada no banco.
async function registrarNoLogAgenda(resultado) {
  if (modo !== "alarme") return;
  const { agenda_log: registro = [] } = await chrome.storage.local.get("agenda_log");
  registro.unshift({ em: Date.now(), horarios: ["carga"], resultado: resultado });
  await chrome.storage.local.set({ agenda_log: registro.slice(0, 30) });
}

async function avisarFimDaCarga(erro, alertas) {
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

// ── Autenticação ───────────────────────────────────────────────────────

function getGoogleToken() {
  return new Promise(function (resolve, reject) {
    chrome.identity.getAuthToken({ interactive: true }, function (token) {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

async function signInComContaBetha(log) {
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
  return result.user.email;
}

// ── Abas ───────────────────────────────────────────────────────────────

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

// Página aberta para a carga: roda uma função autocontida (paginas-tce.js) dentro dela.
async function abrirPagina(url) {
  const tab = await abrirAbaOculta(url);
  return {
    executar: async function (func, args) {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: func, args: args || [] });
      return result;
    },
    fechar: function () {
      return fecharAba(tab);
    },
  };
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

executarCarga({
  db: db,
  parametros: { modo: modo, competencia_inicio: competenciaInicioParam, competencia_fim: competenciaFimParam },
  log: log,
  mostrarModo: function (texto) {
    modoLabelEl.textContent = texto;
  },
  entrar: signInComContaBetha,
  inicio: async function () {
    // Sinaliza pro agendamento (background.js) não abrir outra carga por cima desta.
    await chrome.storage.local.set({ carga_em_andamento: Date.now() });
    chrome.tabs.getCurrent(function (aba) {
      if (aba) chrome.tabs.update(aba.id, { autoDiscardable: false }).catch(function () {});
    });
  },
  abrirPagina: abrirPagina,
  fecharTodas: fecharAbasAbertas,
  credenciaisTce: obterCredenciaisTce,
  obter: async function (chave) {
    return (await chrome.storage.local.get(chave))[chave];
  },
  guardar: function (chave, valor) {
    return chrome.storage.local.set({ [chave]: valor });
  },
  guardarUltimaExecucao: function (resumo) {
    return chrome.storage.local.set({ last_execution: { resumo: resumo, timestamp: Date.now() } });
  },
  concluido: fecharEstaAba,
  fim: async function (erro, alertas) {
    await registrarNoLogAgenda(erro ? "falhou: " + erro : "concluída");
    await chrome.storage.local.remove("carga_em_andamento");
    await fecharAbasAbertas();
    if (modo !== "login") await avisarFimDaCarga(erro, alertas);
  },
});
