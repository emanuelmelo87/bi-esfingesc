import type { Timestamp } from "firebase/firestore";

export type Municipio = {
  codigo_ibge: string;
  nome: string;
  nome_busca: string;
  fornecedor: "Betha" | "Concorrente" | null;
  canal_atendimento: string | null;
  sigla_associacao: string | null;
  associacao_regional: string | null;
  populacao: number | null;
  empresa_software: string | null; // nome granular do concorrente (ex.: PÚBLICA, IPM) — fornecedor é só Betha/Concorrente
  monitoramento_ativo?: boolean; // ausente/undefined = tratado como true
};

export type PendenciaModulo = {
  campo: string; // nome legível do campo no TCE (ex.: "Execução Orçamentária")
  entidade: string; // UG (ex.: "Prefeitura", "Câmara")
  valor: number | null; // valor capturado — null = nunca enviado
  requisito: string; // regra em texto (ex.: "ao menos 1 pacote")
};

export type ModuloStatus = {
  status: string | null;
  pendencias?: PendenciaModulo[]; // por que está "pendente" — vazio/ausente quando status é "ok"
  atualizado_em: Timestamp | null;
};

export type Modulos = {
  contabil: ModuloStatus;
  folha: ModuloStatus;
  contratos: ModuloStatus;
  tributos: ModuloStatus;
};

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
  ratificacao_data_envio?: string | null; // "DD/MM/YYYY" real, do TCE (Ratificações de Remessa)

  modulos: Modulos;

  atualizado_em: Timestamp;
};

export type SnapshotDiario = StatusOperacionalAtual & {
  data: string; // "YYYY-MM-DD"
  timestamp_execucao: Timestamp;
};

export function todosModulosEnviados(modulos: Modulos | null | undefined): boolean {
  if (!modulos) return false;
  return [modulos.contabil, modulos.folha, modulos.contratos, modulos.tributos].every(
    (m) => !!m?.status
  );
}
