// Background service worker — abre o side panel e gerencia o alarme diário de captura.
// Nunca toca o Firestore diretamente: só abre progress.html, que faz todo o trabalho.

const ALARM_PREFIX = "esfinge-";

chrome.action.onClicked.addListener(function (tab) {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  console.log("[Radar e-Sfinge] Alarme disparado:", alarm.name);

  chrome.storage.local.get(["schedule_days"], function (data) {
    var days = data.schedule_days && data.schedule_days.length ? data.schedule_days : [0, 1, 2, 3, 4, 5, 6];
    var hoje = new Date().getDay();
    if (!days.includes(hoje)) {
      console.log("[Radar e-Sfinge] Dia", hoje, "não está nos dias agendados — pulando.");
      return;
    }
    chrome.tabs.create({ url: chrome.runtime.getURL("progress.html") + "?modo=alarme", active: false });
  });
});

chrome.runtime.onStartup.addListener(function () {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
  chrome.storage.local.get(["schedule_enabled", "schedule_times", "schedule_days"], function (data) {
    if (data.schedule_enabled && data.schedule_times && data.schedule_times.length) {
      setupAlarms(data.schedule_times, data.schedule_days || [0, 1, 2, 3, 4, 5, 6]);
    }
  });
});

chrome.runtime.onMessage.addListener(function (msg) {
  if (msg.action === "setup_alarms") setupAlarms(msg.times, msg.days || [0, 1, 2, 3, 4, 5, 6]);
  if (msg.action === "cancel_alarms") clearAllAlarms();
});

function clearAllAlarms(cb) {
  chrome.alarms.getAll(function (alarms) {
    var toRemove = alarms.filter(function (a) {
      return a.name.startsWith(ALARM_PREFIX);
    });
    var pending = toRemove.length;
    if (!pending) {
      if (cb) cb();
      return;
    }
    toRemove.forEach(function (a) {
      chrome.alarms.clear(a.name, function () {
        if (--pending === 0 && cb) cb();
      });
    });
  });
}

function setupAlarms(times, days) {
  days = days || [0, 1, 2, 3, 4, 5, 6];
  clearAllAlarms(function () {
    times.forEach(function (hhmm) {
      var parts = hhmm.split(":");
      var hour = parseInt(parts[0]);
      var min = parseInt(parts[1] || "0");
      var now = new Date();
      var next = new Date();
      next.setHours(hour, min, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      chrome.alarms.create(ALARM_PREFIX + hhmm, { when: next.getTime(), periodInMinutes: 24 * 60 });
      console.log("[Radar e-Sfinge] Alarme", hhmm, "agendado para", next.toLocaleString("pt-BR"), "| dias:", days);
    });
    chrome.storage.local.set({ schedule_days: days, schedule_times: times, schedule_enabled: true });
  });
}
