import type { Modulos } from "@/types/municipio";

// O que importa pro município é ter enviado a ratificação — atrasado (mas
// enviado) é tratado como "ok" na UI toda; só "ausente" (nunca enviado) é
// realmente um problema. Compartilhado entre Home e Ratificação Geral.
export type RatificacaoStatus = "quitado" | "atrasado" | "ausente" | null | undefined;

// Filtro de coluna estilo planilha (Ratificação Geral, Status por Módulo).
export type FiltroEnvio = "todos" | "sim" | "nao";

export function passaFiltroEnvio(status: RatificacaoStatus, filtro: FiltroEnvio): boolean {
  if (filtro === "todos") return true;
  return filtro === "sim" ? ratifEnviado(status) : !ratifEnviado(status);
}

export function ratifEnviado(status: RatificacaoStatus): boolean {
  return status === "quitado" || status === "atrasado";
}

export function ratifTone(status: RatificacaoStatus): "green" | "red" | "yellow" | "gray" {
  if (ratifEnviado(status)) return "green";
  if (status === "ausente") return "red";
  return "gray";
}

export function ratifLabel(status: RatificacaoStatus): string {
  if (status === "quitado") return "Ratificado";
  if (status === "atrasado") return "Enviado";
  if (status === "ausente") return "Ausente";
  return "—";
}

export function ratifTitle(status: RatificacaoStatus, dataEnvio?: string | null): string | undefined {
  if (status === "quitado") return dataEnvio ? `No prazo — enviado em ${dataEnvio}` : "Ratificado no prazo";
  if (status === "atrasado") return dataEnvio ? `Fora do prazo — enviado em ${dataEnvio}` : "Enviado fora do prazo";
  if (status === "ausente") return "Não enviado";
  return undefined;
}

// "Ratificação por Módulo" = SIM: os 4 módulos OK. Se a Ratificação Geral já foi
// concluída no TCE, ela é a fonte oficial e prevalece sobre os módulos (que são
// um proxy reconstruído pela extensão e podem estar desatualizados/errados).
export function todosModulosOk(modulos: Modulos | null | undefined, ratificado: boolean): boolean {
  if (ratificado) return true;
  if (!modulos) return false;
  return (["contabil", "folha", "contratos", "tributos"] as const).every((k) => modulos[k]?.status === "ok");
}
