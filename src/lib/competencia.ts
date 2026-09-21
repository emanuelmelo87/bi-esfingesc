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
