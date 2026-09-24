"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import StatusBadge from "@/components/StatusBadge";
import ContadorResultados from "@/components/ContadorResultados";
import { IconRefresh } from "@/components/icons";
import type { Carga } from "@/types/carga";

function formatarDataHora(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatarIso(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function formatarDuracao(ms: number): string {
  if (!ms && ms !== 0) return "—";
  return (ms / 1000).toFixed(1) + "s";
}

function formatarTotais(totais: Record<string, number> | null): string {
  if (!totais) return "—";
  return Object.entries(totais)
    .map(([chave, valor]) => `${chave}: ${valor}`)
    .join(" · ");
}

export default function AdminCargasPage() {
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    const snap = await getDocs(query(collection(db, "cargas"), orderBy("concluido_em", "desc"), limit(100)));
    setCargas(snap.docs.map((d) => d.data() as Carga));
    setCarregando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, []);

  return (
    <main className="w-full min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Controle de Cargas</h1>
        <ContadorResultados mostrando={cargas.length} total={cargas.length} label="cargas" />
        <button
          type="button"
          onClick={carregar}
          title="Atualizar"
          className="flex h-6 w-6 items-center justify-center rounded-full text-apple-muted transition hover:bg-black/[0.05] hover:text-apple-title dark:hover:bg-white/[0.08]"
        >
          <IconRefresh className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mb-6 text-sm text-apple-secondary">
        Histórico de sincronizações da extensão — cada execução grava um registro aqui assim que termina,
        com quem rodou, quanto tempo levou e quantos documentos foram salvos no Firestore.
      </p>

      {carregando ? (
        <p className="text-apple-secondary">Carregando...</p>
      ) : cargas.length === 0 ? (
        <p className="text-apple-secondary">Nenhuma carga registrada ainda.</p>
      ) : (
        <div className="apple-glass-card overflow-hidden rounded-[22px]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                  <th className="px-6 py-3">Concluído em</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Período</th>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Duração</th>
                  <th className="px-4 py-3" title="Quando cada painel do TCE foi atualizado pela última vez, visto nesta carga">Dados do TCE de</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-6 py-3">Documentos gravados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                {cargas.map((c, i) => (
                  <tr key={i} className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <td className="px-6 py-3.5 font-semibold text-apple-title">{formatarDataHora(c.concluido_em)}</td>
                    <td className="px-4 py-3.5 text-apple-secondary">{c.tipo === "backfill" ? "Backfill" : "Sincronização"}</td>
                    <td className="px-4 py-3.5 text-apple-secondary">{c.periodo ?? "—"}</td>
                    <td className="px-4 py-3.5 text-apple-secondary">{c.usuario ?? "—"}</td>
                    <td className="px-4 py-3.5 text-apple-secondary">{formatarDuracao(c.duracao_ms)}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-apple-secondary">
                      {c.tce_atualizado_em ? (
                        <>
                          <span className="block">Ratificações: {formatarIso(c.tce_atualizado_em.ratificacoes)}</span>
                          <span className="block">Módulos: {formatarIso(c.tce_atualizado_em.modulos)}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge
                        label={
                          c.status === "erro"
                            ? "Erro"
                            : c.alertas?.length
                              ? `Sucesso · ${c.alertas.length} alerta${c.alertas.length > 1 ? "s" : ""}`
                              : "Sucesso"
                        }
                        tone={c.status === "erro" ? "red" : c.alertas?.length ? "yellow" : "green"}
                      />
                      {(c.erro || c.alertas?.length) && (
                        <ul className="mt-1.5 max-w-[460px] space-y-1 text-[11px] leading-snug whitespace-normal">
                          {c.erro && <li className="text-red-700 dark:text-red-400">{c.erro}</li>}
                          {c.alertas?.map((a, j) => (
                            <li key={j} className="text-amber-800 dark:text-amber-300">
                              <span className="font-semibold">{a.fonte}:</span> {a.mensagem}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-6 py-3.5 font-mono text-apple-secondary">{formatarTotais(c.totais)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
