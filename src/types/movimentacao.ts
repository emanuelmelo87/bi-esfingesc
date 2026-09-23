import type { Timestamp } from "firebase/firestore";

export type TipoMovimentacao = "envio" | "remocao" | "alteracao";

export type Movimentacao = {
  carga_id: string;
  criado_em: Timestamp | null;
  codigo_ibge: string;
  municipio: string;
  competencia: string | null;
  fonte: "ratificacao" | "modulo" | "cnd";
  campo: string;
  tipo: TipoMovimentacao;
  valor_anterior: string | null;
  valor_novo: string | null;
  detalhe_anterior: string | null;
  detalhe_novo: string | null;
};
