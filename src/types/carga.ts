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
};
