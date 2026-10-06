// Confere a regra da agenda da nuvem. Uso: node functions/teste-agenda.mjs
import assert from "node:assert/strict";
import { agoraBrasilia, horariosVencidos } from "./src/agenda.js";

const agenda = { ativo: true, horarios: ["08:30", "12:00", "17:00"], dias: [1, 2, 3, 4, 5] };
const segunda = (minutos) => ({ data: "2026-10-05", minutos, diaSemana: 1 });

assert.deepEqual(horariosVencidos(agenda, segunda(8 * 60 + 29), []), [], "antes do horário");
assert.deepEqual(horariosVencidos(agenda, segunda(8 * 60 + 30), []), ["08:30"], "no horário");
assert.deepEqual(horariosVencidos(agenda, segunda(8 * 60 + 35), ["08:30"]), [], "já disparado hoje");
assert.deepEqual(horariosVencidos(agenda, segunda(9 * 60 + 31), []), [], "passou da janela de 60 min");
assert.deepEqual(horariosVencidos(agenda, { ...segunda(12 * 60), diaSemana: 0 }, []), [], "domingo fora da agenda");
assert.deepEqual(horariosVencidos({ ...agenda, ativo: false }, segunda(12 * 60), []), [], "agenda desligada");
assert.deepEqual(horariosVencidos({ ...agenda, dias: [] }, { ...segunda(12 * 60), diaSemana: 0 }, []), ["12:00"], "sem dias = todos");

// 2026-10-05 11:30 UTC = segunda, 08:30 em Brasília.
assert.deepEqual(agoraBrasilia(new Date("2026-10-05T11:30:00Z")), { data: "2026-10-05", minutos: 8 * 60 + 30, diaSemana: 1 });
// 02:00 UTC de terça = 23:00 de segunda em Brasília.
assert.deepEqual(agoraBrasilia(new Date("2026-10-06T02:00:00Z")), { data: "2026-10-05", minutos: 23 * 60, diaSemana: 1 });

console.log("ok — agenda da nuvem");
