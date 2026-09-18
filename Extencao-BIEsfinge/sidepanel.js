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
  document.getElementById("sync-status").textContent = "Abrindo captura...";
  chrome.tabs.create({ url: chrome.runtime.getURL("progress.html") + "?modo=manual" });
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
  chrome.runtime.sendMessage({ action: "setup_alarms", times: scheduleTimes, days: scheduleDays });
  document.getElementById("sched-status").textContent = "Agendamento salvo.";
  document.getElementById("sched-status").className = "status ok";
});

document.getElementById("btn-cancel-sched").addEventListener("click", function () {
  chrome.runtime.sendMessage({ action: "cancel_alarms" });
  chrome.storage.local.set({ schedule_enabled: false });
  document.getElementById("sched-status").textContent = "Agendamento cancelado.";
  document.getElementById("sched-status").className = "status ok";
});

// ── Conta TCE ────────────────────────────────────────────────────────
document.getElementById("btn-save-tce").addEventListener("click", function () {
  var matricula = document.getElementById("tce-matricula").value.trim();
  var senha = document.getElementById("tce-senha").value;
  if (!matricula || !senha) {
    document.getElementById("tce-status").textContent = "Preencha matrícula e senha.";
    document.getElementById("tce-status").className = "status err";
    return;
  }
  chrome.storage.local.set({ tce_matricula: matricula, tce_senha: senha }, function () {
    document.getElementById("tce-status").textContent = "Credencial salva.";
    document.getElementById("tce-status").className = "status ok";
  });
});

document.getElementById("btn-clear-tce").addEventListener("click", function () {
  chrome.storage.local.remove(["tce_matricula", "tce_senha"], function () {
    document.getElementById("tce-matricula").value = "";
    document.getElementById("tce-senha").value = "";
    document.getElementById("tce-status").textContent = "Credencial removida.";
    document.getElementById("tce-status").className = "status ok";
  });
});

chrome.storage.local.get(["tce_matricula"], function (data) {
  if (data.tce_matricula) document.getElementById("tce-matricula").value = data.tce_matricula;
});

// ── Estado inicial + reatividade ────────────────────────────────────
chrome.storage.local.get(
  ["auth_status", "last_execution", "schedule_times", "schedule_days"],
  function (data) {
    renderAuth(data.auth_status);
    renderLastExecution(data.last_execution);
    scheduleTimes = data.schedule_times || [];
    scheduleDays = data.schedule_days || [0, 1, 2, 3, 4, 5, 6];
    renderScheduleList();
    document.querySelectorAll(".day-btn").forEach(function (btn) {
      btn.classList.toggle("active", scheduleDays.includes(parseInt(btn.dataset.day)));
    });
  }
);

chrome.storage.onChanged.addListener(function (changes) {
  if (changes.auth_status) renderAuth(changes.auth_status.newValue);
  if (changes.last_execution) renderLastExecution(changes.last_execution.newValue);
});
