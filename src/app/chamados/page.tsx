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
  const [statusPorCompetencia, setStatusPorCompetencia] = useState<Map<string, Map<string, StatusPorCompetencia>>>(new Map());
  const [competencias, setCompetencias] = useState<string[]>([]);
  const [competencia, setCompetencia] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("Betha");
  const [filtroCanal, setFiltroCanal] = useState("todos");
  const [filtroAssociacao, setFiltroAssociacao] = useState("todos");
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

    // Cruzamento por competência; abre na mais recente que já tem módulos capturados.
    const porCompetencia = new Map<string, Map<string, StatusPorCompetencia>>();
    snapStatus.forEach((d) => {
      const s = d.data() as StatusPorCompetencia;
      if (!porCompetencia.has(s.competencia)) porCompetencia.set(s.competencia, new Map());
      porCompetencia.get(s.competencia)!.set(s.codigo_ibge, s);
    });
    const comModulos = [...porCompetencia.keys()]
      .filter((c) => [...porCompetencia.get(c)!.values()].some((s) => s.modulos))
      .sort(compararCompetencias);
    const maisRecente = comModulos[comModulos.length - 1] ?? null;
    setStatusPorCompetencia(porCompetencia);
    setCompetencias(comModulos);
    setCompetencia((atual) => (atual && comModulos.includes(atual) ? atual : maisRecente));
    setCarregando(false);
  }

  const statusPorIbge = useMemo(
    () => (competencia ? statusPorCompetencia.get(competencia) : undefined) ?? new Map<string, StatusPorCompetencia>(),
    [statusPorCompetencia, competencia]
  );
  const indiceCompetencia = competencia ? competencias.indexOf(competencia) : -1;

  const canais = useMemo(
    () => [...new Set([...municipiosPorNome.values()].map((m) => m.canal_atendimento).filter((c): c is string => !!c))].sort(),
    [municipiosPorNome]
  );
  const associacoes = useMemo(
    () => [...new Set([...municipiosPorNome.values()].map((m) => m.sigla_associacao).filter((a): a is string => !!a))].sort(),
    [municipiosPorNome]
  );

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
        if (filtroCanal !== "todos" && (municipio?.canal_atendimento ?? "") !== filtroCanal) return false;
        if (filtroAssociacao !== "todos" && (municipio?.sigla_associacao ?? "") !== filtroAssociacao) return false;
        if (filtroArea !== "todas" && c.v !== filtroArea) return false;
        if (filtroSlo === "estourado" && !c.br) return false;
        if (filtroSlo === "pausado" && (c.br || !c.paused)) return false;
        if (filtroSlo === "no_prazo" && (c.br || c.paused)) return false;
        if (filtroModulo === "pendente" && modulo !== "pendente") return false;
        if (filtroModulo === "ok" && modulo !== "ok") return false;
        return true;
      });
  }, [feed, municipiosPorNome, statusPorIbge, busca, filtroFornecedor, filtroCanal, filtroAssociacao, filtroArea, filtroSlo, filtroModulo]);

  const inputClass =
    "rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <RequireAuth>
      <main className="w-full min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">
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
          ratificação geral da competência escolhida.
          {feed && <> Lista gerada em {formatarDataHora(feed.generatedAt)}.</>}
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-full border border-black/[0.08] bg-white/90 py-1 pr-1.5 pl-1 shadow-xs dark:border-white/10 dark:bg-zinc-800" title="Competência usada no cruzamento com módulo e ratificação">
            <button
              type="button"
              onClick={() => indiceCompetencia > 0 && setCompetencia(competencias[indiceCompetencia - 1])}
              disabled={indiceCompetencia <= 0}
              className="rounded-full px-2 py-0.5 text-[13px] text-apple-secondary transition hover:bg-black/[0.04] disabled:opacity-30 dark:hover:bg-white/10"
              title="Competência anterior"
            >
              ‹
            </button>
            <select
              value={competencia ?? ""}
              onChange={(e) => setCompetencia(e.target.value)}
              className="bg-transparent px-1 text-[12px] font-semibold text-apple-title focus:outline-none dark:text-zinc-100"
            >
              {competencias.length === 0 && <option value="">Sem competências</option>}
              {competencias.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => indiceCompetencia >= 0 && indiceCompetencia < competencias.length - 1 && setCompetencia(competencias[indiceCompetencia + 1])}
              disabled={indiceCompetencia < 0 || indiceCompetencia >= competencias.length - 1}
              className="rounded-full px-2 py-0.5 text-[13px] text-apple-secondary transition hover:bg-black/[0.04] disabled:opacity-30 dark:hover:bg-white/10"
              title="Próxima competência"
            >
              ›
            </button>
          </div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar município ou chamado..." className={inputClass} />
          <select value={filtroFornecedor} onChange={(e) => setFiltroFornecedor(e.target.value)} className={inputClass}>
            <option value="todos">Fornecedor: todos</option>
            <option value="Betha">Betha</option>
            <option value="Concorrente">Concorrente</option>
          </select>
          <select value={filtroCanal} onChange={(e) => setFiltroCanal(e.target.value)} className={inputClass}>
            <option value="todos">Canal: todos</option>
            {canais.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={filtroAssociacao} onChange={(e) => setFiltroAssociacao(e.target.value)} className={inputClass}>
            <option value="todos">Associação: todas</option>
            {associacoes.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
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
                    <th className="px-4 py-3">Canal</th>
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
                  {linhas.map(({ c, municipio, status, modulo }) => (
                    <tr key={c.k} className={`transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] ${c.br ? "bg-red-50/60 dark:bg-red-500/[0.06]" : ""}`}>
                      <td className="px-6 py-3.5 whitespace-nowrap">
                        <a href={URL_JIRA_CHAMADO + c.k} target="_blank" rel="noopener noreferrer" className="font-mono font-semibold text-vinho hover:underline dark:text-blue-400">
                          {c.k}
                        </a>
                        <span className="mt-0.5 block text-[10px] text-apple-muted">{c.t} · P{c.p}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold text-apple-title">{c.m}</span>
                        <span className="mt-0.5 block max-w-[320px] truncate text-[10px] text-apple-muted" title={c.e}>{c.e}</span>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-apple-secondary">{municipio?.canal_atendimento ?? "—"}</td>
                      <td className="px-4 py-3.5 text-apple-secondary">{c.v}</td>
                      <td className="min-w-[260px] px-4 py-3.5 text-apple-title">
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

        {feed && (
          <details className="mt-6 text-[11px] text-apple-muted">
            <summary className="w-fit cursor-pointer hover:text-apple-secondary">
              Filtro do Jira que retorna estes chamados · {feed.total} no Jira{feed.fetched !== feed.total ? ` (${feed.fetched} lidos)` : ""}
            </summary>
            <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
              {clausulas.map((cl, i) => (
                <div key={i} className="contents">
                  <dt className="font-semibold text-apple-secondary">{cl.campo}</dt>
                  <dd>
                    {cl.exceto && <span className="mr-1 font-semibold text-red-600 dark:text-red-400">exceto</span>}
                    {cl.valores.join(" · ")}
                  </dd>
                </div>
              ))}
            </dl>
            <code className="mt-2 block overflow-x-auto rounded-lg bg-black/[0.04] p-2 font-mono whitespace-pre-wrap dark:bg-white/[0.06]">{feed.jql}</code>
          </details>
        )}
      </main>
    </RequireAuth>
  );
}
