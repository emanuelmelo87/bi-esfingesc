"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";
import StatusBadge from "@/components/StatusBadge";
import ContadorResultados from "@/components/ContadorResultados";
import { IconRefresh } from "@/components/icons";
import { compararCompetencias } from "@/lib/competencia";
import { ratifEnviado } from "@/lib/ratificacao";
import {
  carregarChamados,
  formatarDuracao,
  interpretarJql,
  MODULO_POR_AREA,
  normalizarNome,
  PAINEL_CHAMADOS,
  URL_JIRA_CHAMADO,
  type Chamado,
  type FeedChamados,
} from "@/lib/chamados";
import type { Municipio } from "@/types/municipio";
import type { StatusPorCompetencia } from "@/types/competencia";

type FiltroSlo = "todos" | "estourado" | "pausado" | "no_prazo";
type FiltroModulo = "todos" | "pendente" | "ok";

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function diasAberto(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function SloCelula({ c }: { c: Chamado }) {
  const tempo = c.rem !== null && c.rem !== undefined ? formatarDuracao(c.rem) : null;
  if (c.br) return <><StatusBadge label="Estourado" tone="red" />{tempo && <span className="mt-0.5 block text-[10px] text-apple-muted">há {tempo}</span>}</>;
  if (c.paused) return <><StatusBadge label="Pausado" tone="gray" />{tempo && <span className="mt-0.5 block text-[10px] text-apple-muted">restam {tempo}</span>}</>;
  return <><StatusBadge label="No prazo" tone="green" />{tempo && <span className="mt-0.5 block text-[10px] text-apple-muted">restam {tempo}</span>}</>;
}

export default function ChamadosPage() {
  const { user } = useAuth();

  const [feed, setFeed] = useState<FeedChamados | null>(null);
  const [erroFeed, setErroFeed] = useState<string | null>(null);
  const [municipiosPorNome, setMunicipiosPorNome] = useState<Map<string, Municipio>>(new Map());
  const [statusPorIbge, setStatusPorIbge] = useState<Map<string, StatusPorCompetencia>>(new Map());
  const [competencia, setCompetencia] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("Betha");
  const [filtroArea, setFiltroArea] = useState("todas");
  const [filtroSlo, setFiltroSlo] = useState<FiltroSlo>("todos");
  const [filtroModulo, setFiltroModulo] = useState<FiltroModulo>("todos");

  async function carregar() {
    if (!user) return;
    setCarregando(true);
    setErroFeed(null);
    const [resFeed, snapMun, snapStatus] = await Promise.all([
      carregarChamados().catch((e: Error) => {
        setErroFeed(e.message);
        return null;
      }),
      getDocs(collection(db, "municipios")),
      getDocs(collection(db, "status_por_competencia")),
    ]);
    setFeed(resFeed);
    setMunicipiosPorNome(new Map(snapMun.docs.map((d) => {
      const m = d.data() as Municipio;
      return [m.nome_busca, m];
    })));

    // Cruzamento com a competência mais recente que já tem módulos capturados.
    const docs = snapStatus.docs.map((d) => d.data() as StatusPorCompetencia);
    const competencias = [...new Set(docs.filter((d) => d.modulos).map((d) => d.competencia))].sort(compararCompetencias);
    const maisRecente = competencias[competencias.length - 1] ?? null;
    setCompetencia(maisRecente);
    setStatusPorIbge(new Map(docs.filter((d) => d.competencia === maisRecente).map((d) => [d.codigo_ibge, d])));
    setCarregando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const clausulas = useMemo(() => (feed?.jql ? interpretarJql(feed.jql) : []), [feed]);
  const areas = useMemo(() => [...new Set((feed?.issues ?? []).map((c) => c.v).filter(Boolean))].sort(), [feed]);

  const linhas = useMemo(() => {
    const termo = normalizarNome(busca);
    return (feed?.issues ?? [])
      .map((c) => {
        const municipio = municipiosPorNome.get(normalizarNome(c.m || "")) ?? null;
        const status = municipio ? statusPorIbge.get(municipio.codigo_ibge) : undefined;
        const chaveModulo = MODULO_POR_AREA[c.v];
        // Ratificação geral concluída prevalece, igual à tela Status por Módulo.
        const modulo = !chaveModulo || !status ? null : ratifEnviado(status.ratificacao_status) ? "ok" : status.modulos?.[chaveModulo]?.status ?? null;
        return { c, municipio, status, modulo };
      })
      .filter(({ c, municipio, modulo }) => {
        if (termo && !normalizarNome(c.m || "").includes(termo) && !c.k.toUpperCase().includes(termo)) return false;
        if (filtroFornecedor !== "todos" && (municipio?.fornecedor ?? "") !== filtroFornecedor) return false;
        if (filtroArea !== "todas" && c.v !== filtroArea) return false;
        if (filtroSlo === "estourado" && !c.br) return false;
        if (filtroSlo === "pausado" && (c.br || !c.paused)) return false;
        if (filtroSlo === "no_prazo" && (c.br || c.paused)) return false;
        if (filtroModulo === "pendente" && modulo !== "pendente") return false;
        if (filtroModulo === "ok" && modulo !== "ok") return false;
        return true;
      });
  }, [feed, municipiosPorNome, statusPorIbge, busca, filtroFornecedor, filtroArea, filtroSlo, filtroModulo]);

  const inputClass =
    "rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <RequireAuth>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Chamados</h1>
          <div className="flex items-center gap-2">
            <ContadorResultados mostrando={linhas.length} total={feed?.issues.length ?? 0} label="chamados" />
            <button
              onClick={carregar}
              title="Atualizar dados"
              className="rounded-full border border-black/[0.08] bg-white/80 p-1.5 text-apple-title shadow-xs transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <IconRefresh className="h-4 w-4" />
            </button>
            <a
              href={PAINEL_CHAMADOS}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              Painel original
            </a>
          </div>
        </div>
        <p className="mb-4 text-sm text-apple-secondary">
          Chamados abertos de e-Sfinge no Jira Atendimento, cruzados com o status do módulo da mesma área e a
          ratificação geral {competencia ? `da competência ${competencia}` : "da competência mais recente"}.
        </p>

        {feed && (
          <section aria-label="Filtro do Jira" className="apple-glass-card mb-4 rounded-[22px] p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[11px] font-bold tracking-wider text-apple-muted uppercase">Filtro que retorna estes chamados</h2>
              <span className="text-[11px] text-apple-muted">
                Gerado em {formatarDataHora(feed.generatedAt)} · {feed.total} chamados no Jira
                {feed.fetched !== feed.total ? ` (${feed.fetched} lidos)` : ""}
              </span>
            </div>
            <dl className="grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-[auto_1fr]">
              {clausulas.map((cl, i) => (
                <div key={i} className="contents">
                  <dt className="font-semibold text-apple-title">{cl.campo}</dt>
                  <dd className="text-apple-secondary">
                    {cl.exceto && <span className="mr-1 font-semibold text-red-600 dark:text-red-400">exceto</span>}
                    {cl.valores.join(" · ")}
                  </dd>
                </div>
              ))}
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-medium text-apple-muted hover:text-apple-title">Ver JQL completa</summary>
              <code className="mt-2 block overflow-x-auto rounded-lg bg-black/[0.04] p-2 font-mono text-[11px] whitespace-pre-wrap text-apple-secondary dark:bg-white/[0.06]">
                {feed.jql}
              </code>
            </details>
          </section>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar município ou chamado..." className={inputClass} />
          <select value={filtroFornecedor} onChange={(e) => setFiltroFornecedor(e.target.value)} className={inputClass}>
            <option value="todos">Fornecedor: todos</option>
            <option value="Betha">Betha</option>
            <option value="Concorrente">Concorrente</option>
          </select>
          <select value={filtroArea} onChange={(e) => setFiltroArea(e.target.value)} className={inputClass}>
            <option value="todas">Área: todas</option>
            {areas.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <select value={filtroSlo} onChange={(e) => setFiltroSlo(e.target.value as FiltroSlo)} className={inputClass}>
            <option value="todos">SLO: todos</option>
            <option value="estourado">Estourado</option>
            <option value="pausado">Pausado</option>
            <option value="no_prazo">No prazo</option>
          </select>
          <select value={filtroModulo} onChange={(e) => setFiltroModulo(e.target.value as FiltroModulo)} className={inputClass}>
            <option value="todos">Módulo: todos</option>
            <option value="pendente">Módulo pendente</option>
            <option value="ok">Módulo OK</option>
          </select>
        </div>

        {carregando ? (
          <p className="text-apple-secondary">Carregando...</p>
        ) : erroFeed ? (
          <p className="text-apple-secondary">
            Não foi possível ler os chamados ({erroFeed}). O arquivo é mantido fora deste sistema — tente de novo ou abra o painel original.
          </p>
        ) : linhas.length === 0 ? (
          <p className="text-apple-secondary">Nenhum chamado com esses filtros.</p>
        ) : (
          <div className="apple-glass-card overflow-hidden rounded-[22px]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                    <th className="px-6 py-3">Chamado</th>
                    <th className="px-4 py-3">Município</th>
                    <th className="px-4 py-3">Área</th>
                    <th className="px-4 py-3">Assunto</th>
                    <th className="px-4 py-3">Situação</th>
                    <th className="px-4 py-3">Responsável</th>
                    <th className="px-4 py-3">SLO</th>
                    <th className="px-4 py-3">Aberto há</th>
                    <th className="px-4 py-3">Módulo {competencia ?? ""}</th>
                    <th className="px-6 py-3">Ratificação {competencia ?? ""}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                  {linhas.map(({ c, status, modulo }) => (
                    <tr key={c.k} className={`transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] ${c.br ? "bg-red-50/60 dark:bg-red-500/[0.06]" : ""}`}>
                      <td className="px-6 py-3.5 whitespace-nowrap">
                        <a href={URL_JIRA_CHAMADO + c.k} target="_blank" rel="noopener noreferrer" className="font-mono font-semibold text-vinho hover:underline dark:text-blue-400">
                          {c.k}
                        </a>
                        <span className="mt-0.5 block text-[10px] text-apple-muted">{c.t} · P{c.p}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-apple-title">{c.m}</span>
                        <span className="mt-0.5 block max-w-[220px] truncate text-[10px] text-apple-muted" title={c.e}>{c.e}</span>
                      </td>
                      <td className="px-4 py-3.5 text-apple-secondary">{c.v}</td>
                      <td className="max-w-[280px] px-4 py-3.5 text-apple-title">
                        <span className="line-clamp-2" title={c.s}>{c.s}</span>
                      </td>
                      <td className="px-4 py-3.5 text-apple-secondary">{c.st}</td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-apple-secondary">{c.a || "—"}</td>
                      <td className="px-4 py-3.5 whitespace-nowrap"><SloCelula c={c} /></td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-apple-secondary tabular-nums">{diasAberto(c.c)} dias</td>
                      <td className="px-4 py-3.5">
                        {modulo === "ok" ? (
                          <StatusBadge label="OK" tone="green" />
                        ) : modulo === "pendente" ? (
                          <StatusBadge label="Pendente" tone="yellow" />
                        ) : (
                          <StatusBadge label="—" tone="gray" />
                        )}
                      </td>
                      <td className="px-6 py-3.5">
                        {status ? (
                          <StatusBadge label={ratifEnviado(status.ratificacao_status) ? "SIM" : "NÃO"} tone={ratifEnviado(status.ratificacao_status) ? "green" : "red"} />
                        ) : (
                          <StatusBadge label="—" tone="gray" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </RequireAuth>
  );
}
