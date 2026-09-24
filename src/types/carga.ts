import type { Timestamp } from "firebase/firestore";

export type Carga = {
  tipo: "sync" | "backfill";
  periodo: string | null;
  usuario: string | null;
  iniciado_em: Timestamp | null;
  concluido_em: Timestamp | null;
  duracao_ms: number;
  status: "sucesso" | "erro";
  erro: string | null;
  totais: Record<string, number> | null;
  // Última recarga de cada painel do TCE vista na carga (ISO). Ausente em cargas antigas.
  tce_atualizado_em?: { ratificacoes: string | null; modulos: string | null } | null;
  // O que saiu do padrão esperado nos dados do TCE nesta carga. Ausente em cargas antigas.
  alertas?: { fonte: string; mensagem: string }[];
};
