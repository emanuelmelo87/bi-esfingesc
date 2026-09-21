import type { Timestamp } from "firebase/firestore";
import type { Modulos } from "@/types/municipio";

// Doc ID: "{AAAA-MM}_{codigo_ibge}", ex.: "2026-08_4200051".
// Gravado pela extensão (Componente 1b/2 em modo backfill, ou acumulado a cada
// sincronização normal com a competência "atual" de cada fonte).
export type StatusPorCompetencia = {
  codigo_ibge: string;
  municipio: string;
  competencia: string; // "MM/AAAA" — mesmo formato usado no filtro do Pipeline
  ratificacao_status?: "quitado" | "atrasado" | "ausente" | null;
  ratificacao_atualizado_em?: Timestamp | null;
  ratificacao_data_envio?: string | null; // "DD/MM/YYYY" real, do TCE (Ratificações de Remessa)
  modulos?: Modulos;
  atualizado_em: Timestamp;
};
