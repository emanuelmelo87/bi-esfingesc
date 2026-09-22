"use client";

import { useState } from "react";
import { collection, getDocs, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { IconRefresh, IconSpeechBubble } from "@/components/icons";
import { ratifLabel } from "@/lib/ratificacao";
import type { StatusPorCompetencia } from "@/types/competencia";

function paraMillis(dataBR: string): number {
  const [d, m, a] = dataBR.split("/").map(Number);
  return new Date(a, m - 1, d).getTime();
}

function formatarDataHora(ts: Timestamp | null): string {
  if (!ts) return "—";
  // Fixa America/Sao_Paulo em vez do fuso do sistema do usuário — os dados
  // são sempre de SC, então a hora exibida não deve depender de onde/como o
  // computador de quem está olhando está configurado.
  return ts.toDate().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export default function NovidadesBalao({ variant = "sidebar" }: { variant?: "sidebar" | "mobile" }) {
  const { user } = useAuth();
  const [porCompetencia, setPorCompetencia] = useState<StatusPorCompetencia[]>([]);
  const [aberto, setAberto] = useState(false);
  const [carregado, setCarregado] = useState(false);

  // status_por_competencia (não status_operacional_atual) — é a coleção que
  // toda sincronização grava, tanto o modo normal quanto o backfill de uma
  // competência específica. status_operacional_atual só é tocado no modo
  // normal, então o balão ficava "vazio" pra quem sempre testa via backfill.
  // Busca pontual, só quando o balão é aberto pela primeira vez — como ele
  // fica montado em toda página (sidebar), um onSnapshot aqui reconsultava a
  // coleção inteira a cada navegação, mesmo sem ninguém nunca abrir o balão.
  async function carregar() {
    if (!user) return;
    const snap = await getDocs(collection(db, "status_por_competencia"));
    setPorCompetencia(snap.docs.map((d) => d.data() as StatusPorCompetencia));
    setCarregado(true);
  }

  async function abrir() {
    setAberto(true);
    if (carregado) return;
    await carregar();
  }

  const ultimaConsulta = porCompetencia.reduce<Timestamp | null>((max, s) => {
    if (!s.atualizado_em) return max;
    if (!max || s.atualizado_em.toMillis() > max.toMillis()) return s.atualizado_em;
    return max;
  }, null);

  // Um envio por município (o mais recente entre as competências capturadas
  // dele), senão o mesmo município repete uma vez por competência na lista.
  const maisRecentePorMunicipio = new Map<string, StatusPorCompetencia & { ratificacao_data_envio: string }>();
  for (const s of porCompetencia) {
    if (!s.ratificacao_data_envio) continue;
    const atual = maisRecentePorMunicipio.get(s.codigo_ibge);
    if (!atual || paraMillis(s.ratificacao_data_envio) > paraMillis(atual.ratificacao_data_envio)) {
      maisRecentePorMunicipio.set(s.codigo_ibge, { ...s, ratificacao_data_envio: s.ratificacao_data_envio });
    }
  }
  const ultimosEnvios = [...maisRecentePorMunicipio.values()]
    .sort((a, b) => paraMillis(b.ratificacao_data_envio) - paraMillis(a.ratificacao_data_envio))
    .slice(0, 8);

  const botaoClass =
    variant === "sidebar"
      ? "flex h-10 w-10 items-center justify-center rounded-2xl text-zinc-500 transition-all duration-200 ease-out hover:scale-110 hover:bg-white/[0.08] hover:text-white active:scale-95"
      : "flex h-8 w-8 items-center justify-center rounded-full text-apple-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]";
  const painelClass =
    variant === "sidebar"
      ? "absolute bottom-0 left-full z-50 ml-3 w-80"
      : "absolute right-0 top-full z-50 mt-2 w-80";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (aberto ? setAberto(false) : abrir())}
        aria-label="Novidades"
        title="Novidades — últimos dados atualizados"
        className={botaoClass}
      >
        <IconSpeechBubble className="h-5 w-5" />
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div
            className={`${painelClass} apple-glass-card rounded-2xl p-4 text-left`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-apple-title">Novidades</h3>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] whitespace-nowrap text-apple-muted">
                  Consultado {formatarDataHora(ultimaConsulta)}
                </span>
                <button
                  type="button"
                  onClick={carregar}
                  title="Atualizar"
                  className="flex h-5 w-5 items-center justify-center rounded-full text-apple-muted transition hover:bg-black/[0.05] hover:text-apple-title dark:hover:bg-white/[0.08]"
                >
                  <IconRefresh className="h-3 w-3" />
                </button>
              </div>
            </div>
            <p className="mb-2 text-[11px] font-medium tracking-wider text-apple-muted uppercase">
              Últimos envios de ratificação
            </p>
            {ultimosEnvios.length === 0 ? (
              <p className="text-[12px] text-apple-secondary">Nenhum envio capturado ainda.</p>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto">
                {ultimosEnvios.map((s) => (
                  <li key={s.codigo_ibge} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="truncate font-medium text-apple-title">{s.municipio}</span>
                    <span className="shrink-0 font-mono text-apple-secondary">
                      {s.ratificacao_data_envio} · {ratifLabel(s.ratificacao_status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
