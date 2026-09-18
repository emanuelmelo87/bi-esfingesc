import type { Timestamp } from "firebase/firestore";

export type Municipio = {
  codigo_ibge: string;
  nome: string;
  nome_busca: string;
  fornecedor: "Betha" | "Concorrente" | null;
  canal_atendimento: string | null;
  monitoramento_ativo?: boolean; // ausente/undefined = tratado como true
};

export type ModuloStatus = {
  status: string | null;
  atualizado_em: Timestamp | null;
};

export type Modulos = {
  contabil: ModuloStatus;
  folha: ModuloStatus;
  contratos: ModuloStatus;
  tributos: ModuloStatus;
};

export type EtapaPipeline =
  | "nao_iniciado"
  | "em_andamento"
  | "aguardando_cliente"
  | "concluido";

export type StatusOperacionalAtual = {
  codigo_ibge: string;
  municipio: string;

  cnd_status: "regular" | "irregular" | null;
  cnd_bimestre: string | null;
  cnd_validade: string | null;
  cnd_numero: string | null;
  cnd_atualizado_em: Timestamp | null;

  ratificacao_status: "quitado" | "atrasado" | "ausente" | null;
  ratificacao_atualizado_em: Timestamp | null;

  modulos: Modulos;

  analista: string | null;
  equipe: string | null;
  etapa_pipeline: EtapaPipeline | null;
  canal_atendimento_override: string | null;
  competencia_referencia: string | null;

  atualizado_em: Timestamp;
};

export type SnapshotDiario = StatusOperacionalAtual & {
  data: string; // "YYYY-MM-DD"
  timestamp_execucao: Timestamp;
};
