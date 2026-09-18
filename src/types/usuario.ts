import type { Timestamp } from "firebase/firestore";

export type Perfil = "ADMIN_GERAL" | "GESTOR_CANAL" | "ANALISTA" | "LEITURA";

export type Usuario = {
  email: string;
  nome: string;
  perfil: Perfil;
  canal_primario: string | null;
  ativo: boolean;
  criado_em: Timestamp;
  ultimo_login: Timestamp;
};
