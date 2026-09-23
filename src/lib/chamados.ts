// Chamados de e-Sfinge do Jira Atendimento, lidos do arquivo público que o
// painel externo gera (não copiamos pro Firestore). Só traz chamados abertos.
export const FEED_CHAMADOS = "https://arimanoelgomes-ctrl.github.io/esfinge_pequenas_medias/data.json";
export const PAINEL_CHAMADOS = "https://arimanoelgomes-ctrl.github.io/esfinge_pequenas_medias/";
export const URL_JIRA_CHAMADO = "https://atendimento.betha.com.br/browse/";

// Campos abreviados como vêm no arquivo.
export type Chamado = {
  k: string; // chave, ex. BTHSC-337078
  s: string; // assunto
  st: string; // situação
  sc: string; // categoria da situação (To Do / In Progress)
  a: string; // responsável
  p: string; // prioridade (1 = mais alta)
  t: string; // tipo (Incidente, Dúvida...)
  c: string; // criado em (ISO)
  u: string; // atualizado em (ISO)
  f: string; // funcionalidade
  pf: string; // portfólio
  v: string; // área (Pessoal, Arrecadação, Contratos, Contábil)
  e: string; // entidade
  m: string; // município
  eq: string; // equipe
  br: boolean; // SLO de atendimento estourado
  rem: number | null; // ms restantes (negativo = estourado há), no momento da geração
  paused: boolean; // SLO pausado
};

export type FeedChamados = {
  generatedAt: string;
  total: number;
  fetched: number;
  jql: string;
  issues: Chamado[];
};

export async function carregarChamados(): Promise<FeedChamados> {
  const resp = await fetch(`${FEED_CHAMADOS}?ts=${Date.now()}`, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Arquivo de chamados respondeu ${resp.status}`);
  return resp.json();
}

// Área do chamado → módulo do TCE usado nas nossas telas.
export const MODULO_POR_AREA: Record<string, "contabil" | "folha" | "contratos" | "tributos"> = {
  Contábil: "contabil",
  Pessoal: "folha",
  Contratos: "contratos",
  Arrecadação: "tributos",
};

// Mesma normalização do nome_busca gravado em `municipios`.
export function normalizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Chamados por nome_busca do município.
export function chamadosPorMunicipio(issues: Chamado[]): Map<string, Chamado[]> {
  const mapa = new Map<string, Chamado[]>();
  for (const c of issues) {
    const chave = normalizarNome(c.m || "");
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave)!.push(c);
  }
  return mapa;
}

export function resumoChamados(lista: Chamado[]): string {
  return lista.map((c) => `${c.k} · ${c.v} · ${c.st}${c.br ? " · SLO estourado" : ""}\n${c.s}`).join("\n\n");
}

export function formatarDuracao(ms: number): string {
  const s = Math.abs(ms) / 1000;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Filtro (JQL) em linguagem de gente ──────────────────────────────────

const ROTULO_CAMPO_JQL: Record<string, string> = {
  "cf[32400]": "Portfólio",
  "cf[10335]": "Funcionalidade",
  "cf[21500]": "Equipe responsável",
  statusCategory: "Situação",
  issuetype: "Tipo",
  status: "Status",
  project: "Projeto",
};

const ROTULO_VALOR_JQL: Record<string, string> = { Done: "Concluído" };

export type ClausulaJql = { campo: string; exceto: boolean; valores: string[] };

// Quebra a JQL em "campo: valores" pra mostrar no cabeçalho. Cláusula que não
// segue o formato simples (campo operador valor) aparece como texto cru.
export function interpretarJql(jql: string): ClausulaJql[] {
  const semOrdem = jql.split(/\s+ORDER\s+BY\s+/i)[0];
  return semOrdem.split(/\s+AND\s+/i).map((clausula) => {
    const m = clausula.trim().match(/^(\S+)\s+(not in|in|!=|=)\s+(.+)$/i);
    if (!m) return { campo: "Condição", exceto: false, valores: [clausula.trim()] };
    const [, campo, operador, resto] = m;
    const valores = resto.startsWith("(")
      ? [...resto.matchAll(/"([^"]+)"|([^,()\s][^,()]*)/g)].map((v) => (v[1] ?? v[2]).trim())
      : [resto.replace(/^"|"$/g, "").trim()];
    return {
      campo: ROTULO_CAMPO_JQL[campo] ?? campo,
      exceto: /^(not in|!=)$/i.test(operador),
      valores: valores.map((v) => ROTULO_VALOR_JQL[v] ?? v),
    };
  });
}
