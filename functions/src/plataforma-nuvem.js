// Plataforma da carga na nuvem: Chrome headless (Puppeteer) no lugar das abas
// da extensão e Firestore pelo Admin SDK. A lógica é a mesma (carga.js).

const CONFIG = "config/carga_nuvem";

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// A página pode estar no meio de uma navegação (ex.: logo depois de clicar em
// "Entrar" no login do TCE): espera ela assentar e tenta de novo uma vez.
async function avaliar(page, fn, args) {
  try {
    return await page.evaluate(fn, ...args);
  } catch (err) {
    if (!/context was destroyed|detached|navigat/i.test(err.message)) throw err;
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});
    return page.evaluate(fn, ...args);
  }
}

export function criarPlataformaNuvem({ db, browser, parametros, credenciais }) {
  const abertas = new Set();
  return {
    db,
    parametros,
    log: (msg, tipo) => (tipo === "err" ? console.error : console.log)(msg),
    entrar: async (log) => {
      log("Carga na nuvem (Cloud Functions) — sem login Google, gravação pelo Admin SDK.", "ok");
      return "nuvem";
    },
    inicio: async () => {},
    abrirPagina: async (url) => {
      const page = await browser.newPage();
      abertas.add(page);
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
      } catch (err) {
        if (/timeout/i.test(err.message)) throw new Error("página não terminou de carregar em 60s: " + url);
        throw err;
      }
      await esperar(2500); // settle: renderização Angular, igual à extensão
      return {
        executar: (fn, args) => avaliar(page, fn, args || []),
        fechar: async () => {
          abertas.delete(page);
          await page.close().catch(() => {});
        },
      };
    },
    fecharTodas: async () => {
      for (const page of abertas) await page.close().catch(() => {});
      abertas.clear();
    },
    credenciaisTce: async () => credenciais,
    // O que a extensão guarda no chrome.storage, a nuvem guarda num doc de config.
    obter: async (chave) => {
      const snap = await db.doc(CONFIG).get();
      return snap.exists ? snap.get(chave) : undefined;
    },
    guardar: (chave, valor) => db.doc(CONFIG).set({ [chave]: valor }, { merge: true }),
    guardarUltimaExecucao: async () => {}, // o resultado já fica em "cargas"
    concluido: () => {},
    fim: async () => {},
  };
}
