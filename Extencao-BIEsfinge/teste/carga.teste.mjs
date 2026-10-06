// Roda carga.js inteira contra um TCE e um Firestore de mentira (295 municípios)
// e confere o fluxo: login, capturas, gravação, cobertura e encerramento.
// Uso: npm test (na pasta da extensão).
import { build } from "esbuild";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const saida = path.join(os.tmpdir(), "carga-teste-" + Date.now() + ".mjs");
await build({
  entryPoints: [path.join(aqui, "../src/carga.js")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: saida,
  alias: { "firebase/firestore": path.join(aqui, "firestore-falso.js") },
  logLevel: "silent",
});
const { executarCarga } = await import(pathToFileURL(saida).href);
const banco = globalThis.__bancoFalso;

const NOMES = Array.from({ length: 295 }, (_, i) => "Município " + (i + 1));
const MODULOS = [
  "Assinatura Balancete do Razão", "Execução Orçamentária", "Registros Contábeis", "Relação Folha/Liquidação",
  "Relação Tributário/Contábil - Impostos", "Relação Tributário/Contábil - Taxas", "Tributário",
  "Situações de Obras/Serviços de Engenharia em Atraso",
];
NOMES.forEach((nome, i) => {
  const ibge = String(4200000 + i);
  banco.set("municipios/" + ibge, { codigo_ibge: ibge, nome, nome_busca: nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase() });
});

function plataformaFalsa(parametros, chamadas) {
  const abertas = new Set();
  return {
    db: {},
    parametros,
    log: (msg) => chamadas.log.push(msg),
    entrar: async () => "teste@betha.com.br",
    inicio: async () => chamadas.push("inicio"),
    abrirPagina: async () => {
      const pagina = {
        executar: async (fn, args = []) => {
          switch (fn.name) {
            case "extractCNDPublico":
              return NOMES.map((n, i) => ({ ente: n, bimestre: "4º", status: i === 0 ? "irregular" : "regular", validade: "31/12/2026", numero: "1" }));
            case "extractRatificacoesGlobais":
              return {
                linhas: NOMES.map((n) => ({ nomeMunicipio: n, situacao: "quitado", data: "10/09/2026" })),
                recarga: "2026-10-05T11:00:00Z", colunaEncontrada: true, colunasVistas: [args[0]],
                coresDesconhecidas: [], valoresInesperados: [],
              };
            case "isLoginPage": return false;
            case "readTokenFromPage": return "jwt";
            case "callTicketQlik": return "ticket";
            case "extractQlikModulos":
              return {
                recarga: "2026-10-05T12:00:00Z",
                linhas: NOMES.flatMap((n) => MODULOS.map((m) => ({
                  municipio: n, anoMes: args[0], modulo: m, unidade: "PREFEITURA MUNICIPAL",
                  qtd: m.startsWith("Assinatura") ? 2 : m.startsWith("Situações") ? 0 : 1,
                }))),
              };
            default:
              throw new Error("função inesperada na página: " + fn.name);
          }
        },
        fechar: async () => abertas.delete(pagina),
      };
      abertas.add(pagina);
      return pagina;
    },
    fecharTodas: async () => abertas.clear(),
    credenciaisTce: async () => [{ matricula: "1", senha: "x" }],
    obter: async () => undefined,
    guardar: async () => {},
    guardarUltimaExecucao: async (resumo) => chamadas.push("ultima:" + resumo),
    concluido: () => chamadas.push("concluido"),
    fim: async (erro, alertas) => chamadas.push("fim:" + (erro || "ok") + ":" + alertas.length + ":abertas=" + abertas.size),
  };
}

function docs(colecao) {
  return [...banco].filter(([k]) => k.startsWith(colecao + "/")).map(([, v]) => v);
}

// Backfill de duas competências incluindo a vigente (mês anterior a hoje).
const hoje = new Date();
const vigente = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
const fmt = (d) => String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear();
const anterior = fmt(new Date(vigente.getFullYear(), vigente.getMonth() - 1, 1));
const chamadas = [];
chamadas.log = [];
const r = await executarCarga(plataformaFalsa({ modo: "manual", competencia_inicio: anterior, competencia_fim: fmt(vigente) }, chamadas));

assert.equal(r.erro, null, "carga sem erro");
assert.deepEqual(r.alertas, [], "sem alertas: " + JSON.stringify(r.alertas));
assert.equal(r.cobertura.length, 2);
for (const c of r.cobertura) assert.ok(c.ratificacoes === 295 && c.modulos === 295, "cobertura 295/295 em " + c.competencia);
assert.equal(docs("status_por_competencia").length, 590, "295 × 2 competências");
assert.equal(docs("status_operacional_atual").length, 295, "estado atual atualizado (inclui a vigente)");
assert.equal(docs("snapshots_diarios").length, 295);
const carga = banco.get("cargas/" + r.cargaId);
assert.equal(carga.status, "sucesso");
assert.equal(carga.tipo, "backfill");
assert.equal(carga.totais.ratificacoes, 590);
assert.equal(carga.totais.modulos, 590);
assert.equal(carga.totais.cnd, 295);
assert.ok(docs("movimentacoes").length > 0, "1ª carga registra envios como movimentação");
assert.equal(chamadas[0], "inicio");
assert.ok(chamadas.includes("concluido"));
assert.ok(chamadas.at(-1).startsWith("fim:ok:0:abertas=0"), "fim sem erro e sem páginas abertas: " + chamadas.at(-1));
const ok = docs("status_por_competencia").find((d) => d.competencia === fmt(vigente));
assert.equal(ok.modulos.contabil.status, "ok");
assert.equal(ok.ratificacao_status, "quitado");

// Segunda carga: o estado é zerado (nada da anterior vaza) e não há mudança no TCE.
const chamadas2 = [];
chamadas2.log = [];
const r2 = await executarCarga(plataformaFalsa({ modo: "nuvem", competencia_inicio: fmt(vigente) }, chamadas2));
assert.notEqual(r2.cargaId, r.cargaId);
assert.equal(r2.cobertura.length, 1, "cobertura não acumula entre cargas");
assert.equal(banco.get("cargas/" + r2.cargaId).totais.movimentacoes, 0, "sem mudança, sem movimentação");
assert.equal(banco.get("cargas/" + r2.cargaId).modo, "nuvem");

console.log("ok — carga completa (backfill " + anterior + " a " + fmt(vigente) + ") e segunda carga com estado zerado.");
