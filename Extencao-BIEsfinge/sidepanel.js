// Side panel — só lê/grava chrome.storage.local. Nunca toca o Firestore: login e sincronização
// de verdade rodam em progress.js (a única página com o Firebase SDK empacotado).

document.querySelectorAll(".tab-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    document.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
    document.querySelectorAll(".tab-pane").forEach(function (p) { p.classList.remove("active"); });
    btn.classList.add("active");
    document.getElementById("pane-" + btn.dataset.tab).classList.add("active");
  });
});

document.getElementById("btn-signin").addEventListener("click", function () {
  chrome.tabs.create({ url: chrome.runtime.getURL("progress.html") + "?modo=login" });
});

document.getElementById("btn-signout").addEventListener("click", function () {
  chrome.storage.local.set({ auth_status: null });
});

document.getElementById("btn-sync").addEventListener("click", function () {
  var re = /^\d{2}\/\d{4}$/;
  var inicio = document.getElementById("competencia-inicio").value.trim();
  var fim = document.getElementById("competencia-fim").value.trim();
  if (inicio && !re.test(inicio)) {
    document.getElementById("sync-status").textContent = "Competência inicial precisa estar no formato MM/AAAA.";
    document.getElementById("sync-status").className = "status err";
    return;
  }
  if (fim && !re.test(fim)) {
    document.getElementById("sync-status").textContent = "Competência final precisa estar no formato MM/AAAA.";
    document.getElementById("sync-status").className = "status err";
    return;
  }
  if (fim && !inicio) {
    document.getElementById("sync-status").textContent = "Preencha também a competência inicial.";
    document.getElementById("sync-status").className = "status err";
    return;
  }
  chrome.storage.local.set({ ultima_competencia_inicio: inicio, ultima_competencia_fim: fim });

  document.getElementById("sync-status").textContent = "Abrindo captura...";
  document.getElementById("sync-status").className = "status";
  var url = chrome.runtime.getURL("progress.html") + "?modo=manual";
  if (inicio) {
    url += "&competencia_inicio=" + encodeURIComponent(inicio);
    url += "&competencia_fim=" + encodeURIComponent(fim || inicio);
  }
  chrome.tabs.create({ url: url });
});

function renderAuth(authStatus) {
  var signedIn = authStatus && authStatus.signedIn;
  document.getElementById("auth-card").classList.toggle("signed-in", !!signedIn);
  document.getElementById("auth-signed-out").style.display = signedIn ? "none" : "block";
  document.getElementById("auth-signed-in").style.display = signedIn ? "block" : "none";
  if (signedIn) document.getElementById("auth-email").textContent = authStatus.email;
}

function renderLastExecution(lastExecution) {
  var card = document.getElementById("last-exec-card");
  if (!lastExecution) {
    card.classList.remove("visible");
    return;
  }
  card.classList.add("visible");
  document.getElementById("exec-label").textContent = lastExecution.resumo || "Concluído";

  // Alertas da última carga (o TCE mudou algo, ou etapa que não deu certo).
  var alertas = lastExecution.alertas || [];
  card.classList.toggle("alerta", alertas.length > 0 || !!lastExecution.erro);
  card.querySelector(".exec-title").textContent =
    alertas.length ? "Última execução — " + alertas.length + " alerta" + (alertas.length > 1 ? "s" : "") : "Última execução";
  var lista = document.getElementById("exec-alertas");
  lista.innerHTML = "";
  alertas.forEach(function (a) {
    var item = document.createElement("div");
    var fonte = document.createElement("b");
    fonte.textContent = a.fonte + ": ";
    item.appendChild(fonte);
    item.appendChild(document.createTextNode(a.mensagem));
    lista.appendChild(item);
  });
  document.getElementById("exec-timestamp").textContent = lastExecution.timestamp
    ? new Date(lastExecution.timestamp).toLocaleString("pt-BR")
    : "";
}

// ── Agendamento ──────────────────────────────────────────────────────
var scheduleTimes = [];
var scheduleDays = [0, 1, 2, 3, 4, 5, 6];

function renderScheduleList() {
  var list = document.getElementById("sched-list");
  list.innerHTML = "";
  scheduleTimes.forEach(function (hhmm) {
    var item = document.createElement("div");
    item.className = "sched-item";
    item.innerHTML = "<span>" + hhmm + "</span>";
    var btn = document.createElement("button");
    btn.textContent = "Remover";
    btn.addEventListener("click", function () {
      scheduleTimes = scheduleTimes.filter(function (t) { return t !== hhmm; });
      renderScheduleList();
    });
    item.appendChild(btn);
    list.appendChild(item);
  });
}

document.getElementById("btn-add-time").addEventListener("click", function () {
  var value = document.getElementById("sched-new-time").value;
  if (value && !scheduleTimes.includes(value)) {
    scheduleTimes.push(value);
    renderScheduleList();
  }
});

document.querySelectorAll(".day-btn").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var day = parseInt(btn.dataset.day);
    if (scheduleDays.includes(day)) {
      scheduleDays = scheduleDays.filter(function (d) { return d !== day; });
      btn.classList.remove("active");
    } else {
      scheduleDays.push(day);
      btn.classList.add("active");
    }
  });
});

document.getElementById("btn-save-sched").addEventListener("click", function () {
  if (!scheduleTimes.length) {
    document.getElementById("sched-status").textContent = "Adicione ao menos um horário.";
    document.getElementById("sched-status").className = "status err";
    return;
  }
  var re = /^\d{2}\/\d{4}$/;
  var compInicio = document.getElementById("sched-competencia-inicio").value.trim();
  var compFim = document.getElementById("sched-competencia-fim").value.trim();
  if (compInicio && !re.test(compInicio)) {
    document.getElementById("sched-status").textContent = "Competência inicial precisa estar no formato MM/AAAA.";
    document.getElementById("sched-status").className = "status err";
    return;
  }
  if (compFim && !re.test(compFim)) {
    document.getElementById("sched-status").textContent = "Competência final precisa estar no formato MM/AAAA.";
    document.getElementById("sched-status").className = "status err";
    return;
  }
  if (compFim && !compInicio) {
    document.getElementById("sched-status").textContent = "Preencha também a competência inicial.";
    document.getElementById("sched-status").className = "status err";
    return;
  }
  chrome.runtime.sendMessage({
    action: "setup_alarms",
    times: scheduleTimes,
    days: scheduleDays,
    competenciaInicio: compInicio || null,
    competenciaFim: compInicio ? (compFim || compInicio) : null,
  });
  document.getElementById("sched-status").textContent = "Agendamento salvo.";
  document.getElementById("sched-status").className = "status ok";
});

document.getElementById("btn-cancel-sched").addEventListener("click", function () {
  chrome.runtime.sendMessage({ action: "cancel_alarms" });
  chrome.storage.local.set({ schedule_enabled: false });
  document.getElementById("sched-status").textContent = "Agendamento cancelado.";
  document.getElementById("sched-status").className = "status ok";
});

// ── Conta TCE — lista de credenciais; se o login falhar com uma, o
// progress.js tenta a próxima da lista automaticamente (ver obterTicketQlik). ──
var tceCredenciais = [];

function renderTceList() {
  var list = document.getElementById("tce-list");
  list.innerHTML = "";
  tceCredenciais.forEach(function (cred, i) {
    var item = document.createElement("div");
    item.className = "sched-item";
    item.innerHTML = "<span>" + cred.matricula + "</span>";
    var btn = document.createElement("button");
    btn.textContent = "Remover";
    btn.addEventListener("click", function () {
      tceCredenciais.splice(i, 1);
      salvarTceCredenciais();
    });
    item.appendChild(btn);
    list.appendChild(item);
  });
}

function salvarTceCredenciais() {
  chrome.storage.local.set({ tce_credenciais: tceCredenciais }, function () {
    renderTceList();
  });
}

document.getElementById("btn-add-tce").addEventListener("click", function () {
  var matricula = document.getElementById("tce-matricula").value.trim();
  var senha = document.getElementById("tce-senha").value;
  if (!matricula || !senha) {
    document.getElementById("tce-status").textContent = "Preencha matrícula e senha.";
    document.getElementById("tce-status").className = "status err";
    return;
  }
  if (tceCredenciais.some(function (c) { return c.matricula === matricula; })) {
    document.getElementById("tce-status").textContent = "Essa matrícula já está na lista.";
    document.getElementById("tce-status").className = "status err";
    return;
  }
  tceCredenciais.push({ matricula: matricula, senha: senha });
  salvarTceCredenciais();
  document.getElementById("tce-matricula").value = "";
  document.getElementById("tce-senha").value = "";
  document.getElementById("tce-status").textContent = "Credencial adicionada.";
  document.getElementById("tce-status").className = "status ok";
});

// ── Estado inicial + reatividade ────────────────────────────────────
chrome.storage.local.get(
  [
    "auth_status", "last_execution", "schedule_times", "schedule_days",
    "schedule_competencia_inicio", "schedule_competencia_fim",
    "tce_credenciais", "tce_matricula", "tce_senha",
    "ultima_competencia_inicio", "ultima_competencia_fim",
  ],
  function (data) {
    renderAuth(data.auth_status);
    renderLastExecution(data.last_execution);
    if (data.ultima_competencia_inicio) document.getElementById("competencia-inicio").value = data.ultima_competencia_inicio;
    if (data.ultima_competencia_fim) document.getElementById("competencia-fim").value = data.ultima_competencia_fim;
    scheduleTimes = data.schedule_times || [];
    scheduleDays = data.schedule_days || [0, 1, 2, 3, 4, 5, 6];
    renderScheduleList();
    document.querySelectorAll(".day-btn").forEach(function (btn) {
      btn.classList.toggle("active", scheduleDays.includes(parseInt(btn.dataset.day)));
    });
    if (data.schedule_competencia_inicio) document.getElementById("sched-competencia-inicio").value = data.schedule_competencia_inicio;
    if (data.schedule_competencia_fim) document.getElementById("sched-competencia-fim").value = data.schedule_competencia_fim;

    if (data.tce_credenciais && data.tce_credenciais.length) {
      tceCredenciais = data.tce_credenciais;
      renderTceList();
    } else if (data.tce_matricula && data.tce_senha) {
      // Migração da credencial única salva pela versão anterior da extensão.
      tceCredenciais = [{ matricula: data.tce_matricula, senha: data.tce_senha }];
      salvarTceCredenciais();
      chrome.storage.local.remove(["tce_matricula", "tce_senha"]);
    }
  }
);

chrome.storage.onChanged.addListener(function (changes) {
  if (changes.auth_status) renderAuth(changes.auth_status.newValue);
  if (changes.last_execution) renderLastExecution(changes.last_execution.newValue);
});
