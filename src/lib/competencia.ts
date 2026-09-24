import type { StatusPorCompetencia } from "@/types/competencia";

export const MESES_ABREV = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

// "MM/AAAA" da competência anterior à atual (ex.: hoje em 09/2026 -> "08/2026").
export function competenciaMesAnterior(): string {
  const hoje = new Date();
  const anterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  return `${String(anterior.getMonth() + 1).padStart(2, "0")}/${anterior.getFullYear()}`;
}

export function anoDaCompetencia(competenciaMMAAAA: string): string {
  return competenciaMMAAAA.split("/")[1];
}

export function mesDaCompetencia(competenciaMMAAAA: string): number {
  return Number(competenciaMMAAAA.split("/")[0]);
}

// Ordena "MM/AAAA" cronologicamente — string.sort() sozinho erra ao cruzar anos
// (ex.: "01/2027" vem antes de "12/2026" na ordenação lexicográfica).
export function compararCompetencias(a: string, b: string): number {
  const chave = (c: string) => `${anoDaCompetencia(c)}-${String(mesDaCompetencia(c)).padStart(2, "0")}`;
  return chave(a).localeCompare(chave(b));
}

// Última competência (cronologicamente) que tem pelo menos um município com
// módulos capturados — evita abrir num mês em curso que ainda não tem dado.
export function competenciaMaisRecenteComDados(
  competencias: string[],
  historicoPorIbge: Map<string, Map<string, StatusPorCompetencia>>
): string | null {
  for (let i = competencias.length - 1; i >= 0; i--) {
    const c = competencias[i];
    for (const porCompetencia of historicoPorIbge.values()) {
      if (porCompetencia.get(c)?.modulos) return c;
    }
  }
  return competencias[competencias.length - 1] ?? null;
}
