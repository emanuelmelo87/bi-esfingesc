"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { IconSpeechBubble } from "@/components/icons";
import { ratifLabel } from "@/lib/ratificacao";
import type { StatusOperacionalAtual } from "@/types/municipio";

function paraMillis(dataBR: string): number {
  const [d, m, a] = dataBR.split("/").map(Number);
  return new Date(a, m - 1, d).getTime();
}

function formatarDataHora(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function NovidadesBalao({ variant = "sidebar" }: { variant?: "sidebar" | "mobile" }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<StatusOperacionalAtual[]>([]);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "status_operacional_atual"), (snap) => {
      setStatus(snap.docs.map((d) => d.data() as StatusOperacionalAtual));
    });
    return unsub;
  }, [user]);

  const ultimaConsulta = status.reduce<Timestamp | null>((max, s) => {
    if (!s.atualizado_em) return max;
    if (!max || s.atualizado_em.toMillis() > max.toMillis()) return s.atualizado_em;
    return max;
  }, null);

  const ultimosEnvios = [...status]
    .filter((s): s is StatusOperacionalAtual & { ratificacao_data_envio: string } => !!s.ratificacao_data_envio)
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
        onClick={() => setAberto((v) => !v)}
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
              <span className="text-[10px] whitespace-nowrap text-apple-muted">
                Consultado {formatarDataHora(ultimaConsulta)}
              </span>
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
