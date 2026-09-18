import type { Timestamp } from "firebase/firestore";

export type AtribuicaoMunicipio = {
  codigo_ibge: string;
  analista: string | null;
  equipe: string | null;
  atribuido_por: string | null;
  atribuido_em: Timestamp | null;
};
