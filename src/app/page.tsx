"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";
import StatTile from "@/components/StatTile";
import ProportionBar from "@/components/ProportionBar";
import StatusBadge from "@/components/StatusBadge";
import type { Municipio, StatusOperacionalAtual } from "@/types/municipio";
import type { Timestamp } from "firebase/firestore";

function ratifTone(status: string | null | undefined): "green" | "red" | "yellow" | "gray" {
  if (status === "quitado") return "green";
  if (status === "atrasado") return "red";
  if (status === "ausente") return "yellow";
  return "gray";
}

function ratifLabel(status: string | null | undefined) {
  if (status === "quitado") return "Quitado";
  if (status === "atrasado") return "Atrasado";
  if (status === "ausente") return "Ausente";
  return "—";
}

function diasDesde(ts: Timestamp | null | undefined): string {
  if (!ts) return "—";
  const dias = Math.floor((Date.now() - ts.toDate().getTime()) / (1000 * 60 * 60 * 24));
  if (dias <= 0) return "hoje";
  return `há ${dias}d`;
}

export default function Home() {
  const { user } = useAuth();
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [statusPorIbge, setStatusPorIbge] = useState<Map<string, StatusOperacionalAtual>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [buscaCritica, setBuscaCritica] = useState("");

  async function carregarMunicipios() {
    if (!user) return;
    const snap = await getDocs(collection(db, "municipios"));
    setMunicipios(snap.docs.map((d) => d.data() as Municipio));
  }

  useEffect(() => {
    if (!user) return;
    getDocs(collection(db, "municipios")).then((snap) => {
      setMunicipios(snap.docs.map((d) => d.data() as Municipio));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "status_operacional_atual"), (snap) => {
      const proximo = new Map<string, StatusOperacionalAtual>();
      snap.forEach((d) => proximo.set(d.id, d.data() as StatusOperacionalAtual));
      setStatusPorIbge(proximo);
      setAtualizadoEm(new Date());
      setCarregando(false);
    });
    return unsub;
  }, [user]);

  const status = useMemo(() => [...statusPorIbge.values()], [statusPorIbge]);
  const totalMunicipios = municipios.length;

  const monitorados = municipios.filter((m) => m.monitoramento_ativo !== false).length;
  const cndIrregular = status.filter((s) => s.cnd_status === "irregular").length;
  const ratificacaoAtrasada = status.filter((s) => s.ratificacao_status === "atrasado").length;
  const semAnalista = status.filter((s) => !s.analista).length;
  const pct = (n: number) => (totalMunicipios > 0 ? `${Math.round((n / totalMunicipios) * 1000) / 10}% da base` : "—");

  const porFornecedor = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const m of municipios) {
      const chave = m.fornecedor ?? "Não classificado";
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  }, [municipios]);

  const porCanal = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const m of municipios) {
      const chave = m.canal_atendimento ?? "Não classificado";
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }
    return [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  }, [municipios]);

  const criticos = useMemo(() => {
    const termo = buscaCritica.trim().toUpperCase();
    return municipios
      .map((m) => ({ municipio: m, s: statusPorIbge.get(m.codigo_ibge) }))
      .filter(({ s }) => s?.cnd_status === "irregular" || s?.ratificacao_status === "atrasado")
      .filter(({ municipio }) => !termo || municipio.nome_busca.includes(termo))
      .sort((a, b) => a.municipio.nome.localeCompare(b.municipio.nome, "pt-BR"));
  }, [municipios, statusPorIbge, buscaCritica]);

  return (
    <RequireAuth>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <section className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-vinho uppercase dark:text-rose-400">TCE-SC</span>
              <span className="h-1 w-1 rounded-full bg-black/20 dark:bg-white/20" />
              <span className="text-[11px] font-semibold tracking-wider text-apple-secondary uppercase">
                Prestação de Contas
              </span>
            </div>
            <h1 className="text-3xl leading-tight font-bold tracking-[-0.03em] text-apple-title sm:text-[34px]">
              Radar e-Sfinge
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-apple-secondary">
              Envio de dados e ratificações dos municípios catarinenses ao TCE-SC
            </p>
          </div>
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/15 bg-emerald-500/[0.08] px-3 py-1.5 text-[12px] font-medium text-emerald-800 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
              </span>
              <span>
                {atualizadoEm
                  ? `Atualizado ${atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} `
                  : "Carregando "}
                <span className="font-normal text-emerald-700/80 dark:text-emerald-400/70">(dados ao vivo)</span>
              </span>
            </div>
            <button
              onClick={carregarMunicipios}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition-all hover:bg-white active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <svg className="h-3.5 w-3.5 text-apple-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Atualizar agora
            </button>
          </div>
        </section>

        {carregando ? (
          <p className="text-apple-secondary">Carregando...</p>
        ) : (
          <>
            <section aria-label="Indicadores chave" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                eyebrow="Cobertura estadual"
                badge={{ label: "100% de SC", tone: "gray" }}
                valor={monitorados}
                label="municípios monitorados"
                footerLabel="Unidades ativas"
                footerValor={`${monitorados} / ${totalMunicipios}`}
              />
              <StatTile
                eyebrow="Alerta fiscal"
                badge={
                  cndIrregular > 0
                    ? { label: "Atenção imediata", tone: "red" }
                    : { label: "Sem pendências", tone: "green" }
                }
                valor={cndIrregular}
                label="com CND irregular"
                tone={cndIrregular > 0 ? "red" : "green"}
                footerLabel="Proporção da base"
                footerValor={pct(cndIrregular)}
              />
              <StatTile
                eyebrow="Cronograma e-Sfinge"
                badge={
                  ratificacaoAtrasada > 0
                    ? { label: "Prazo expirado", tone: "yellow" }
                    : { label: "Em dia", tone: "green" }
                }
                valor={ratificacaoAtrasada}
                label="com ratificação atrasada"
                tone={ratificacaoAtrasada > 0 ? "yellow" : "green"}
                footerLabel="Proporção da base"
                footerValor={pct(ratificacaoAtrasada)}
              />
              <StatTile
                eyebrow="Distribuição interna"
                badge={semAnalista > 0 ? { label: "Triagem pendente", tone: "yellow" } : { label: "Em dia", tone: "green" }}
                valor={semAnalista}
                label="sem analista atribuído"
                tone={semAnalista > 0 ? "yellow" : "green"}
                footerLabel="Fila de atribuição"
                footerValor={pct(semAnalista) + " não distribuído"}
              />
            </section>

            <section aria-label="Distribuição técnica" className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="apple-glass-card rounded-[22px] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-[11px] font-bold tracking-wider text-apple-muted uppercase">Por fornecedor</h2>
                    <p className="mt-0.5 text-[12px] text-apple-secondary">Sistema de software contábil usado</p>
                  </div>
                  <span className="rounded-full border border-black/[0.04] bg-black/[0.04] px-2 py-0.5 font-mono text-[11px] font-medium text-apple-title dark:border-white/10 dark:bg-white/[0.06]">
                    {totalMunicipios} total
                  </span>
                </div>
                <div className="space-y-4">
                  {porFornecedor.map(([nome, qtd]) => (
                    <ProportionBar key={nome} label={nome} valor={qtd} total={totalMunicipios} />
                  ))}
                </div>
              </div>
              <div className="apple-glass-card rounded-[22px] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-[11px] font-bold tracking-wider text-apple-muted uppercase">Por canal de atendimento</h2>
                    <p className="mt-0.5 text-[12px] text-apple-secondary">Equipe responsável pelo atendimento</p>
                  </div>
                  <span className="rounded-full border border-black/[0.04] bg-black/[0.04] px-2 py-0.5 font-mono text-[11px] font-medium text-apple-title dark:border-white/10 dark:bg-white/[0.06]">
                    {totalMunicipios} total
                  </span>
                </div>
                <div className="space-y-4">
                  {porCanal.map(([nome, qtd]) => (
                    <ProportionBar key={nome} label={nome} valor={qtd} total={totalMunicipios} />
                  ))}
                </div>
              </div>
            </section>

            <section aria-label="Ações de acesso rápido" className="flex flex-wrap items-center gap-2.5">
              <Link
                href="/pipeline"
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-vinho-hover to-vinho px-4 py-2 text-[13px] font-semibold text-white shadow-apple-btn ring-1 ring-white/20 transition hover:brightness-105 active:scale-[0.98]"
              >
                Ver Pipeline completo
              </Link>
              <Link
                href="/matriz"
                className="inline-flex items-center justify-center rounded-full border border-black/[0.08] bg-white/80 px-4 py-2 text-[13px] font-medium text-apple-title shadow-apple-btn transition active:scale-[0.98] dark:border-white/10 dark:bg-white/5"
              >
                Ver Matriz de Módulos
              </Link>
              <Link
                href="/evolucao"
                className="inline-flex items-center justify-center rounded-full border border-black/[0.08] bg-white/80 px-4 py-2 text-[13px] font-medium text-apple-title shadow-apple-btn transition active:scale-[0.98] dark:border-white/10 dark:bg-white/5"
              >
                Ver Evolução
              </Link>
            </section>

            <section className="apple-glass-card overflow-hidden rounded-[22px]">
              <div className="flex flex-col gap-3 border-b border-black/[0.05] bg-white/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-white/[0.03]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500 ring-4 ring-rose-500/20" />
                    <h2 className="text-[15px] font-semibold tracking-tight text-apple-title">
                      Municípios com Inconsistências Críticas
                    </h2>
                  </div>
                  <p className="mt-0.5 text-[12px] text-apple-secondary">
                    {criticos.length === 0
                      ? "Nenhuma pendência de CND ou ratificação no momento."
                      : `Exibindo ${criticos.length} município(s) com CND irregular ou ratificação atrasada`}
                  </p>
                </div>
                <input
                  value={buscaCritica}
                  onChange={(e) => setBuscaCritica(e.target.value)}
                  placeholder="Filtrar município..."
                  className="rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs placeholder:text-apple-muted focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              {criticos.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                        <th className="px-6 py-3">Município</th>
                        <th className="px-4 py-3">Status CND</th>
                        <th className="px-4 py-3">Ratificação</th>
                        <th className="px-4 py-3">Atualizado</th>
                        <th className="px-6 py-3">Analista</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                      {criticos.map(({ municipio, s }) => (
                        <tr key={municipio.codigo_ibge} className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                          <td className="px-6 py-3.5 font-semibold text-apple-title">{municipio.nome}</td>
                          <td className="px-4 py-3.5">
                            {s?.cnd_status === "irregular" ? (
                              <StatusBadge label="Irregular" tone="red" />
                            ) : (
                              <StatusBadge label="Regular" tone="green" />
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusBadge label={ratifLabel(s?.ratificacao_status)} tone={ratifTone(s?.ratificacao_status)} />
                          </td>
                          <td className="px-4 py-3.5 font-mono text-apple-secondary">
                            {diasDesde(s?.cnd_status === "irregular" ? s?.cnd_atualizado_em : s?.ratificacao_atualizado_em)}
                          </td>
                          <td className="px-6 py-3.5">
                            {s?.analista ?? <span className="text-[11px] text-apple-muted italic">Não atribuído</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-black/[0.05] bg-black/[0.015] px-6 py-3 text-[11px] text-apple-secondary dark:border-white/10 dark:bg-white/[0.02]">
                <span>
                  Mostrando {criticos.length} de {totalMunicipios} municípios
                </span>
                <Link href="/pipeline" className="flex items-center gap-1 font-semibold text-vinho transition hover:opacity-80 dark:text-rose-400">
                  Ir para o Pipeline <span aria-hidden="true">→</span>
                </Link>
              </div>
            </section>
          </>
        )}
      </main>
    </RequireAuth>
  );
}
