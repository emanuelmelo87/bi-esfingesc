// Background service worker — abre o side panel e dispara as cargas agendadas.
// Nunca toca o Firestore diretamente: só abre progress.html, que faz todo o trabalho.

const RELOGIO = "esfinge-relogio";
// Quanto tempo depois do horário ainda vale disparar (computador dormindo, Chrome fechado).
// ponytail: janela fixa; aumentar se as máquinas costumam ficar desligadas mais tempo no horário.
const JANELA_ATRASO_MIN = 90;
// Carga marcada como "em andamento" há mais que isso é considerada travada/abandonada.
const CARGA_TRAVADA_MS = 60 * 60 * 1000;
const MAX_LOG = 30;

chrome.action.onClicked.addListener(function (tab) {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});

// Um "relógio" de 1 minuto que confere a agenda, em vez de um alarme diário por
// horário: o Chrome apaga os alarmes da extensão quando ela é recarregada ou
// atualizada, e eles só eram recriados no onStartup (Chrome reiniciando) — então
// depois de cada reload o agendamento ficava morto. O relógio é garantido toda vez
// que o service worker sobe, inclusive logo após um reload.
function garantirRelogio() {
  chrome.alarms.get(RELOGIO, function (alarme) {
    if (!alarme) chrome.alarms.create(RELOGIO, { delayInMinutes: 1, periodInMinutes: 1 });
  });
}

garantirRelogio();
chrome.runtime.onInstalled.addListener(garantirRelogio);
chrome.runtime.onStartup.addListener(garantirRelogio);

// Remove os alarmes por horário da versão anterior ("esfinge-HH:MM").
chrome.alarms.getAll(function (alarmes) {
  alarmes.forEach(function (a) {
    if (a.name.startsWith("esfinge-") && a.name !== RELOGIO) chrome.alarms.clear(a.name);
  });
});

chrome.alarms.onAlarm.addListener(function (alarme) {
  if (alarme.name === RELOGIO) verificarAgenda();
});

function dataLocal(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function minutosDoDia(hhmm) {
  const partes = hhmm.split(":");
  return parseInt(partes[0], 10) * 60 + parseInt(partes[1] || "0", 10);
}

async function registrarDisparo(horarios, resultado) {
  const { agenda_log: log = [] } = await chrome.storage.local.get("agenda_log");
  log.unshift({ em: Date.now(), horarios: horarios, resultado: resultado });
  await chrome.storage.local.set({ agenda_log: log.slice(0, MAX_LOG) });
}

async function verificarAgenda() {
  const d = await chrome.storage.local.get([
    "schedule_enabled", "schedule_times", "schedule_days",
    "schedule_competencia_inicio", "schedule_competencia_fim",
    "agenda_disparos", "carga_em_andamento",
  ]);
  if (!d.schedule_enabled || !d.schedule_times || !d.schedule_times.length) return;

  const agora = new Date();
  const dias = d.schedule_days && d.schedule_days.length ? d.schedule_days : [0, 1, 2, 3, 4, 5, 6];
  if (!dias.includes(agora.getDay())) return;

  const hoje = dataLocal(agora);
  const minutoAgora = agora.getHours() * 60 + agora.getMinutes();
  const disparos = d.agenda_disparos || {}; // { "08:00": "2026-09-24" } = já disparado hoje
  const vencidos = d.schedule_times.filter(function (t) {
    const m = minutosDoDia(t);
    return disparos[t] !== hoje && minutoAgora >= m && minutoAgora - m <= JANELA_ATRASO_MIN;
  });
  if (!vencidos.length) return;

  // Marca antes de abrir a aba: vários horários vencidos juntos (ex.: o computador
  // acordou às 18:10 com 17:57 e 18:00 pendentes) viram uma carga só, e o próximo
  // tique não dispara de novo.
  vencidos.forEach(function (t) { disparos[t] = hoje; });
  await chrome.storage.local.set({ agenda_disparos: disparos });

  if (d.carga_em_andamento && Date.now() - d.carga_em_andamento < CARGA_TRAVADA_MS) {
    await registrarDisparo(vencidos, "pulado — já havia uma carga em andamento");
    return;
  }

  let url = chrome.runtime.getURL("progress.html") + "?modo=alarme";
  if (d.schedule_competencia_inicio) {
    url += "&competencia_inicio=" + encodeURIComponent(d.schedule_competencia_inicio);
    url += "&competencia_fim=" + encodeURIComponent(d.schedule_competencia_fim || d.schedule_competencia_inicio);
  }
  chrome.tabs.create({ url: url, active: false });
  await registrarDisparo(vencidos, "disparado");
}

chrome.runtime.onMessage.addListener(function (msg) {
  if (msg.action === "setup_alarms") {
    // Horários que já passaram hoje contam como feitos: salvar às 11:30 não
    // dispara na hora uma carga "das 10:00".
    const agora = new Date();
    const hoje = dataLocal(agora);
    const minutoAgora = agora.getHours() * 60 + agora.getMinutes();
    const disparos = {};
    msg.times.forEach(function (t) {
      if (minutosDoDia(t) <= minutoAgora) disparos[t] = hoje;
    });
    chrome.storage.local.set({
      schedule_enabled: true,
      schedule_times: msg.times,
      schedule_days: msg.days || [0, 1, 2, 3, 4, 5, 6],
      schedule_competencia_inicio: msg.competenciaInicio || null,
      schedule_competencia_fim: msg.competenciaFim || null,
      agenda_disparos: disparos,
    });
    garantirRelogio();
  }
  if (msg.action === "cancel_alarms") chrome.storage.local.set({ schedule_enabled: false });
});
