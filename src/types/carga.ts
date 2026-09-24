import type { Timestamp } from "firebase/firestore";

export type Carga = {
  tipo: "sync" | "backfill";
  // "alarme" = disparada pelo agendamento. Ausente em cargas antigas.
  modo?: "manual" | "alarme";
  periodo: string | null;
  usuario: string | null;
  iniciado_em: Timestamp | null;
  concluido_em: Timestamp | null;
  duracao_ms: number;
  // "em_andamento" enquanto roda; se ficar assim sem pulso recente, a carga não terminou.
  status: "sucesso" | "erro" | "em_andamento";
  etapa?: string; // última etapa registrada durante a execução
  pulso_em?: Timestamp | null; // último sinal de vida da carga em andamento
  erro: string | null;
  totais: Record<string, number> | null;
  // Última recarga de cada painel do TCE vista na carga (ISO). Ausente em cargas antigas.
  tce_atualizado_em?: { ratificacoes: string | null; modulos: string | null } | null;
  // O que saiu do padrão esperado nos dados do TCE nesta carga. Ausente em cargas antigas.
  alertas?: { fonte: string; mensagem: string }[];
};
