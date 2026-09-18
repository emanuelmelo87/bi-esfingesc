import { signInWithCredential, GoogleAuthProvider, signOut } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, googleProvider, ALLOWED_EMAIL_DOMAIN } from "./firebase-config.js";

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

async function gravarDocumentoTeste() {
  log("Gravando documento de teste em status_operacional_atual/TESTE_STAGE3...");
  await setDoc(
    doc(db, "status_operacional_atual", "TESTE_STAGE3"),
    { teste_stage3: true, atualizado_em: serverTimestamp() },
    { merge: true }
  );
  log("Gravação concluída — regras do Firestore permitiram a escrita.", "ok");
}

async function main() {
  try {
    await signInComContaBetha();

    if (modo === "login") {
      log("Login concluído. Pode fechar esta aba.", "ok");
      return;
    }

    await gravarDocumentoTeste();

    await chrome.storage.local.set({
      last_execution: {
        resumo: "Teste do Estágio 3 (login + 1 gravação)",
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
