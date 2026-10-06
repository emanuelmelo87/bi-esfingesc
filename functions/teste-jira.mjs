// Confere a tradução dos chamados do Jira. Uso: node functions/teste-jira.mjs
import assert from "node:assert/strict";
import { normalizarChamado, motivoSaida, normalizarNome, cabecalhoAutorizacao } from "./src/jira.js";

const base = {
  key: "BTHSC-1",
  fields: {
    summary: "Erro no envio",
    status: { name: "Em atendimento", statusCategory: { name: "In Progress", key: "indeterminate" } },
    assignee: { displayName: "Fulana" },
    priority: { id: "2", name: "High" },
    issuetype: { name: "Incidente" },
    created: "2026-10-01T10:00:00.000-0300",
    customfield_10335: [{ value: "e-Sfinge" }, { value: "SIOPE" }],
    customfield_32400: { value: "Portfólio Pequenas Contas" },
    customfield_10300: { value: "Contábil" },
    customfield_10202: "1234 - Prefeitura Municipal de São José / SC",
    customfield_10331: "",
    customfield_21500: { value: "Suporte" },
    customfield_24813: { ongoingCycle: { breached: true, paused: false, remainingTime: { millis: -3600000 } }, completeCycles: [] },
  },
};

const c = normalizarChamado(base);
assert.equal(c.k, "BTHSC-1");
assert.equal(c.p, "2 - Alta");
assert.equal(c.f, "e-Sfinge, SIOPE", "funcionalidade em lista vira texto");
assert.equal(c.pf, "Portfólio Pequenas Contas");
assert.equal(c.v, "Contábil");
assert.equal(c.m, "Prefeitura Municipal de São José", "município vazio sai da entidade");
assert.equal(c.br, true, "SLO estourado");
assert.equal(c.rem, -3600000, "tempo restante em ms");
assert.equal(c.paused, false);

const pausado = normalizarChamado({
  key: "BTHSC-2",
  fields: { ...base.fields, customfield_10331: "Joinville", customfield_24813: { ongoingCycle: { breached: false, paused: true, remainingTime: 5000 }, completeCycles: [] } },
});
assert.equal(pausado.m, "Joinville");
assert.equal(pausado.br, false);
assert.equal(pausado.paused, true);
assert.equal(pausado.rem, 5000);

const cicloFechadoEstourado = normalizarChamado({
  key: "BTHSC-3",
  fields: { ...base.fields, customfield_24813: { completeCycles: [{ breached: true, goalTime: 100, elapsedTime: 300 }] } },
});
assert.equal(cicloFechadoEstourado.br, true, "ciclo já fechado e estourado conta");
assert.equal(cicloFechadoEstourado.rem, -200);

assert.equal(motivoSaida(null), "nao_encontrado");
assert.equal(motivoSaida({ fields: { resolution: { name: "Resolvido" }, status: { name: "Fechado" } } }), "resolvido");
assert.equal(motivoSaida({ fields: { status: { name: "Aguardando solicitante", statusCategory: { key: "indeterminate" } } } }), "aguardando");
assert.equal(motivoSaida({ fields: { status: { name: "Em análise", statusCategory: { key: "indeterminate" } } } }), "fora_do_filtro");

assert.equal(normalizarNome("Herval d'Oeste"), "HERVAL D OESTE");

// Credencial: JSON ou o Base64 do cabeçalho Basic, com ou sem "Basic".
const b64 = Buffer.from("usuario:senha").toString("base64");
assert.equal(cabecalhoAutorizacao('{"usuario":"usuario","senha":"senha"}'), "Basic " + b64);
assert.equal(cabecalhoAutorizacao(b64), "Basic " + b64);
assert.equal(cabecalhoAutorizacao("Basic " + b64 + "\n"), "Basic " + b64);
assert.throws(() => cabecalhoAutorizacao(""), /vazio/);

console.log("ok — tradução dos chamados do Jira");
