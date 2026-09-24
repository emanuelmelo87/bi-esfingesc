"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { collection, getDocs, limit, orderBy, query, type Timestamp } from "firebase/firestore";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";
import StatTile from "@/components/StatTile";
import StatusBadge from "@/components/StatusBadge";
import ProportionBar from "@/components/ProportionBar";
import ContadorResultados from "@/components/ContadorResultados";
import ChamadosIndicador from "@/components/ChamadosIndicador";
import { IconRefresh } from "@/components/icons";
import { carregarChamados, chamadosPorMunicipio, type Chamado } from "@/lib/chamados";
import { ratifEnviado, ratifLabel, todosModulosOk } from "@/lib/ratificacao";
import { MESES_ABREV, compararCompetencias, competenciaMaisRecenteComDados, mesDaCompetencia } from "@/lib/competencia";
import type { Municipio, StatusOperacionalAtual } from "@/types/municipio";
import type { StatusPorCompetencia } from "@/types/competencia";
import type { Carga } from "@/types/carga";
import type { Movimentacao } from "@/types/movimentacao";

const AREAS = [
  { key: "contabil", label: "Contábil" },
  { key: "folha", label: "Folha" },
  { key: "contratos", label: "Contratos" },
  { key: "tributos", label: "Tributos" },
] as const;

const LIMITE_ATENCAO = 15;

function formatCompetenciaCurta(c: string) {
  return `${MESES_ABREV[mesDaCompetencia(c) - 1]}/${c.split("/")[1].slice(-2)}`;
}

function formatarData(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function pct(n: number, total: number) {
  return total > 0 ? `${Math.round((n / total) * 1000) / 10}%` : "—";
}

// Legenda com ordem fixa (bom, ruim) — o Legend automático do recharts pode
// inverter a ordem em gráficos empilhados dependendo dos valores dos dados.
function LegendaBomRuim({ labelBom, labelRuim }: { labelBom: string; labelRuim: string }) {
  return (
    <div className="mt-1 flex items-center justify-center gap-4 text-[12px] text-apple-secondary">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--chart-bom)" }} />
        {labelBom}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--chart-ruim)" }} />
        {labelRuim}
      </span>
    </div>
  );
}

function Secao({ titulo, descricao, extra, children }: { titulo: string; descricao?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="apple-glass-card rounded-[22px] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-bold tracking-wider text-apple-muted uppercase">{titulo}</h2>
          {descricao && <p className="mt-0.5 text-[12px] text-apple-secondary">{descricao}</p>}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

const TIPO_MOV: Record<string, { label: string; tone: "green" | "red" | "yellow" }> = {
  envio: { label: "Envio", tone: "green" },
  remocao: { label: "Remoção", tone: "red" },
  alteracao: { label: "Alteração", tone: "yellow" },
};

export default function Home() {
  const { user } = useAuth();
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [historicoPorIbge, setHistoricoPorIbge] = useState<Map<string, Map<string, StatusPorCompetencia>>>(new Map());
  const [competencias, setCompetencias] = useState<string[]>([]);
  const [competencia, setCompetencia] = useState<string | null>(null);
  const [estadoAtualPorIbge, setEstadoAtualPorIbge] = useState<Map<string, StatusOperacionalAtual>>(new Map());
  const [ultimaCarga, setUltimaCarga] = useState<Carga | null>(null);
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);
  const [chamadosPorNome, setChamadosPorNome] = useState<Map<string, Chamado[]>>(new Map());
  const [carregando, setCarregando] = useState(true);

  const [filtroFornecedor, setFiltroFornecedor] = useState("Betha");
  const [filtroCanal, setFiltroCanal] = useState("todos");
  const [filtroAssociacao, setFiltroAssociacao] = useState("todos");

  // Busca pontual + botão Atualizar, como no resto do sistema: o dado só muda
  // quando alguém roda a extensão.
  async function carregar() {
    if (!user) return;
    setCarregando(true);
    // Chamados vêm de um arquivo externo: se ele falhar, a página segue sem eles.
    carregarChamados()
      .then((feed) => setChamadosPorNome(chamadosPorMunicipio(feed.issues)))
      .catch(() => setChamadosPorNome(new Map()));
    const [snapMun, snapHist, snapAtual, snapCarga, snapMov] = await Promise.all([
      getDocs(collection(db, "municipios")),
      getDocs(collection(db, "status_por_competencia")),
      getDocs(collection(db, "status_operacional_atual")),
      getDocs(query(collection(db, "cargas"), orderBy("concluido_em", "desc"), limit(1))),
      getDocs(query(collection(db, "movimentacoes"), orderBy("criado_em", "desc"), limit(50))),
    ]);
    setMunicipios(snapMun.docs.map((d) => d.data() as Municipio));

    const vistas = new Set<string>();
    const porMunicipio = new Map<string, Map<string, StatusPorCompetencia>>();
    snapHist.forEach((d) => {
      const s = d.data() as StatusPorCompetencia;
      vistas.add(s.competencia);
      if (!porMunicipio.has(s.codigo_ibge)) porMunicipio.set(s.codigo_ibge, new Map());
      porMunicipio.get(s.codigo_ibge)!.set(s.competencia, s);
    });
    const ordenadas = [...vistas].sort(compararCompetencias);
    setCompetencias(ordenadas);
    setHistoricoPorIbge(porMunicipio);
    setCompetencia((atual) => (atual && ordenadas.includes(atual) ? atual : competenciaMaisRecenteComDados(ordenadas, porMunicipio)));

    setEstadoAtualPorIbge(new Map(snapAtual.docs.map((d) => [d.id, d.data() as StatusOperacionalAtual])));
    setUltimaCarga(snapCarga.empty ? null : (snapCarga.docs[0].data() as Carga));
    setMovimentacoes(snapMov.docs.map((d) => d.data() as Movimentacao));
    setCarregando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const canais = useMemo(
    () => [...new Set(municipios.map((m) => m.canal_atendimento).filter((c): c is string => !!c))].sort(),
    [municipios]
  );
  const associacoes = useMemo(
    () => [...new Set(municipios.map((m) => m.sigla_associacao).filter((a): a is string => !!a))].sort(),
    [municipios]
  );

  const filtrados = useMemo(
    () =>
      municipios.filter((m) => {
        if (filtroFornecedor !== "todos" && (m.fornecedor ?? "") !== filtroFornecedor) return false;
        if (filtroCanal !== "todos" && (m.canal_atendimento ?? "") !== filtroCanal) return false;
        if (filtroAssociacao !== "todos" && (m.sigla_associacao ?? "") !== filtroAssociacao) return false;
        return true;
      }),
    [municipios, filtroFornecedor, filtroCanal, filtroAssociacao]
  );

  // Situação de cada município filtrado na competência escolhida, com as mesmas
  // regras de Status por Módulo (ratificação geral concluída prevalece).
  const situacoes = useMemo(
    () =>
      filtrados.map((m) => {
        const dados = competencia ? historicoPorIbge.get(m.codigo_ibge)?.get(competencia) : undefined;
        const ratificado = ratifEnviado(dados?.ratificacao_status);
        const areasPendentes = ratificado
          ? []
          : AREAS.filter((a) => dados?.modulos?.[a.key]?.status === "pendente").map((a) => a.label);
        const chamados = chamadosPorNome.get(m.nome_busca) ?? [];
        const cndIrregular = estadoAtualPorIbge.get(m.codigo_ibge)?.cnd_status === "irregular";
        return {
          municipio: m,
          dados,
          ratificado,
          modulosOk: todosModulosOk(dados?.modulos, ratificado),
          faltaSoRatificar: !ratificado && todosModulosOk(dados?.modulos, false),
          areasPendentes,
          chamados,
          cndIrregular,
        };
      }),
    [filtrados, competencia, historicoPorIbge, chamadosPorNome, estadoAtualPorIbge]
  );

  const total = situacoes.length;
  const ratificados = situacoes.filter((s) => s.ratificado).length;
  const modulosCompletos = situacoes.filter((s) => s.modulosOk).length;
  const faltaSoRatificar = situacoes.filter((s) => s.faltaSoRatificar).length;
  const chamadosAbertos = situacoes.reduce((n, s) => n + s.chamados.length, 0);
  const chamadosEstourados = situacoes.reduce((n, s) => n + s.chamados.filter((c) => c.br).length, 0);
  const cndIrregular = situacoes.filter((s) => s.cndIrregular).length;

  const cndConsultadaEm = useMemo(() => {
    let max: Timestamp | null = null;
    for (const s of estadoAtualPorIbge.values()) {
      if (s.cnd_atualizado_em && (!max || s.cnd_atualizado_em.toMillis() > max.toMillis())) max = s.cnd_atualizado_em;
    }
    return max?.toDate() ?? null;
  }, [estadoAtualPorIbge]);

  const atencao = useMemo(() => {
    const comProblema = situacoes
      .map((s) => ({
        ...s,
        problemas: (s.ratificado ? 0 : 1) + s.areasPendentes.length + (s.chamados.length ? 1 : 0) + (s.cndIrregular ? 1 : 0),
        estourado: s.chamados.some((c) => c.br),
      }))
      .filter((s) => s.problemas > 0);
    comProblema.sort(
      (a, b) =>
        b.problemas - a.problemas ||
        Number(b.estourado) - Number(a.estourado) ||
        a.municipio.nome.localeCompare(b.municipio.nome, "pt-BR")
    );
    return comProblema;
  }, [situacoes]);

  const porCanal = useMemo(() => {
    const grupos = new Map<string, { total: number; aRatificar: number }>();
    for (const s of situacoes) {
      const canal = s.municipio.canal_atendimento ?? "Sem canal";
      const g = grupos.get(canal) ?? { total: 0, aRatificar: 0 };
      g.total++;
      if (!s.ratificado) g.aRatificar++;
      grupos.set(canal, g);
    }
    return [...grupos.entries()].sort((a, b) => b[1].aRatificar / b[1].total - a[1].aRatificar / a[1].total);
  }, [situacoes]);

  const dadosGraficos = useMemo(
    () =>
      competencias.map((c) => {
        let modulos = 0;
        let ratif = 0;
        for (const m of filtrados) {
          const dados = historicoPorIbge.get(m.codigo_ibge)?.get(c);
          const ok = ratifEnviado(dados?.ratificacao_status);
          if (todosModulosOk(dados?.modulos, ok)) modulos++;
          if (ok) ratif++;
        }
        return {
          competencia: formatCompetenciaCurta(c),
          completos: modulos,
          pendentes: filtrados.length - modulos,
          ratificados: ratif,
          aRatificar: filtrados.length - ratif,
        };
      }),
    [competencias, filtrados, historicoPorIbge]
  );

  const ultimasMovimentacoes = useMemo(() => {
    const ibges = new Set(filtrados.map((m) => m.codigo_ibge));
    return movimentacoes.filter((m) => ibges.has(m.codigo_ibge)).slice(0, 5);
  }, [movimentacoes, filtrados]);

  const indice = competencia ? competencias.indexOf(competencia) : -1;
  const inputClass =
    "rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <RequireAuth>
      <main className="w-full min-w-0 flex-1 space-y-5 px-4 py-8 sm:px-6 lg:px-8">
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold tracking-wider text-vinho uppercase dark:text-blue-400">TCE-SC</span>
                <span className="h-1 w-1 rounded-full bg-black/20 dark:bg-white/20" />
                <span className="text-[11px] font-semibold tracking-wider text-apple-secondary uppercase">Prestação de Contas</span>
              </div>
              <h1 className="text-3xl leading-tight font-bold tracking-[-0.03em] text-apple-title sm:text-[34px]">BI eSfinge SC</h1>
            </div>
            <button
              onClick={carregar}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition-all hover:bg-white active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <IconRefresh className="h-3.5 w-3.5 text-apple-secondary" />
              Atualizar
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-full border border-black/[0.08] bg-white/90 py-1 pr-1.5 pl-1 shadow-xs dark:border-white/10 dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => indice > 0 && setCompetencia(competencias[indice - 1])}
                disabled={indice <= 0}
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
                onClick={() => indice >= 0 && indice < competencias.length - 1 && setCompetencia(competencias[indice + 1])}
                disabled={indice < 0 || indice >= competencias.length - 1}
                className="rounded-full px-2 py-0.5 text-[13px] text-apple-secondary transition hover:bg-black/[0.04] disabled:opacity-30 dark:hover:bg-white/10"
                title="Próxima competência"
              >
                ›
              </button>
            </div>
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
            <ContadorResultados mostrando={filtrados.length} total={municipios.length} />
          </div>

          {ultimaCarga && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-black/[0.06] bg-white/60 px-4 py-2.5 text-[12px] text-apple-secondary dark:border-white/10 dark:bg-white/[0.03]">
              <span>
                <span className="font-semibold text-apple-title">Última carga:</span> {formatarData(ultimaCarga.concluido_em?.toDate())}
                {ultimaCarga.periodo ? ` (${ultimaCarga.periodo})` : ""}
              </span>
              {ultimaCarga.tce_atualizado_em?.ratificacoes && (
                <span>
                  <span className="font-semibold text-apple-title">TCE atualizou:</span> ratificações{" "}
                  {formatarData(new Date(ultimaCarga.tce_atualizado_em.ratificacoes))}
                  {ultimaCarga.tce_atualizado_em.modulos ? `, módulos ${formatarData(new Date(ultimaCarga.tce_atualizado_em.modulos))}` : ""}
                </span>
              )}
              <span>
                <span className="font-semibold text-apple-title">CND consultada:</span> {formatarData(cndConsultadaEm)}
              </span>
              {ultimaCarga.status === "erro" ? (
                <span className="font-semibold text-red-600 dark:text-red-400">Última carga com erro</span>
              ) : (ultimaCarga.alertas?.length ?? 0) > 0 ? (
                <span
                  className="font-semibold text-amber-700 dark:text-amber-400"
                  title={ultimaCarga.alertas!.map((a) => `${a.fonte}: ${a.mensagem}`).join("\n\n")}
                >
                  {ultimaCarga.alertas!.length} alerta{ultimaCarga.alertas!.length > 1 ? "s" : ""} na captura do TCE
                </span>
              ) : null}
            </div>
          )}
        </section>

        {carregando ? (
          <p className="text-apple-secondary">Carregando...</p>
        ) : (
          <>
            <section aria-label="Indicadores da competência" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatTile
                href="/ratificacao-geral"
                eyebrow={`Ratificação geral ${competencia ?? ""}`}
                badge={total - ratificados > 0 ? { label: `${total - ratificados} a ratificar`, tone: "yellow" } : { label: "Todos ratificados", tone: "green" }}
                valor={ratificados}
                label={`de ${total} ratificados`}
                tone={total - ratificados > 0 ? "yellow" : "green"}
                footerLabel="Proporção"
                footerValor={pct(ratificados, total)}
              />
              <StatTile
                href="/matriz"
                eyebrow="Módulos completos"
                valor={modulosCompletos}
                label={`de ${total} com os 4 módulos OK`}
                tone={modulosCompletos < total ? "yellow" : "green"}
                footerLabel="Proporção"
                footerValor={pct(modulosCompletos, total)}
              />
              <StatTile
                href="/matriz"
                eyebrow="Falta só ratificar"
                badge={faltaSoRatificar > 0 ? { label: "Pronto pra ratificar", tone: "yellow" } : undefined}
                valor={faltaSoRatificar}
                label="com módulos OK e sem ratificação geral"
                tone={faltaSoRatificar > 0 ? "yellow" : "green"}
              />
              <StatTile
                href="/chamados"
                eyebrow="Chamados abertos"
                badge={chamadosEstourados > 0 ? { label: `${chamadosEstourados} SLO estourado`, tone: "red" } : undefined}
                valor={chamadosAbertos}
                label="chamados de e-Sfinge no Jira"
                tone={chamadosEstourados > 0 ? "red" : "gray"}
              />
              <StatTile
                href="/cnd"
                eyebrow="CND irregular"
                badge={cndIrregular > 0 ? { label: "Atenção", tone: "red" } : { label: "Sem pendências", tone: "green" }}
                valor={cndIrregular}
                label={`de ${total} municípios`}
                tone={cndIrregular > 0 ? "red" : "green"}
                footerLabel="Consultada em"
                footerValor={formatarData(cndConsultadaEm)}
              />
            </section>

            <Secao
              titulo="Precisam de atenção"
              descricao={`Municípios com pendência em ${competencia ?? "—"}: ratificação, módulos, chamado aberto ou CND irregular. Os com mais problemas primeiro.`}
              extra={
                <div className="flex items-center gap-2">
                  <ContadorResultados mostrando={Math.min(LIMITE_ATENCAO, atencao.length)} total={atencao.length} />
                  <Link href="/matriz" className="text-[12px] font-semibold text-vinho hover:underline dark:text-blue-400">
                    Ver todos em Status por Módulo →
                  </Link>
                </div>
              }
            >
              {atencao.length === 0 ? (
                <p className="text-sm text-apple-secondary">Nenhum município com pendência nesta competência.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-black/[0.05] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10">
                        <th className="py-2 pr-4">Município</th>
                        <th className="py-2 pr-4">Canal</th>
                        <th className="py-2 pr-4">Ratificação</th>
                        <th className="py-2 pr-4">Módulos pendentes</th>
                        <th className="py-2 pr-4">Chamados</th>
                        <th className="py-2">CND</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                      {atencao.slice(0, LIMITE_ATENCAO).map((s) => (
                        <tr key={s.municipio.codigo_ibge}>
                          <td className="py-2.5 pr-4 font-semibold whitespace-nowrap text-apple-title">{s.municipio.nome}</td>
                          <td className="py-2.5 pr-4 whitespace-nowrap text-apple-secondary">{s.municipio.canal_atendimento ?? "—"}</td>
                          <td className="py-2.5 pr-4">
                            <StatusBadge
                              label={s.ratificado ? "SIM" : s.dados?.ratificacao_status ? ratifLabel(s.dados.ratificacao_status) : "Sem dado"}
                              tone={s.ratificado ? "green" : s.faltaSoRatificar ? "yellow" : "red"}
                            />
                          </td>
                          <td className="py-2.5 pr-4 text-apple-secondary">{s.areasPendentes.length ? s.areasPendentes.join(", ") : "—"}</td>
                          <td className="py-2.5 pr-4">{s.chamados.length ? <ChamadosIndicador lista={s.chamados} /> : <span className="text-apple-muted">—</span>}</td>
                          <td className="py-2.5">{s.cndIrregular ? <StatusBadge label="Irregular" tone="red" /> : <span className="text-apple-muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Secao>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              <Secao titulo="A ratificar por canal" descricao={`Municípios sem ratificação geral em ${competencia ?? "—"}, por canal de atendimento`}>
                <div className="space-y-4">
                  {porCanal.map(([canal, g]) => (
                    <ProportionBar key={canal} label={`${canal} · ${g.total} mun.`} valor={g.aRatificar} total={g.total} />
                  ))}
                </div>
              </Secao>

              <div className="xl:col-span-2">
                <Secao
                  titulo="Últimas movimentações"
                  descricao="O que mudou nas cargas mais recentes"
                  extra={
                    <Link href="/movimentacoes" className="text-[12px] font-semibold text-vinho hover:underline dark:text-blue-400">
                      Ver todas →
                    </Link>
                  }
                >
                  {ultimasMovimentacoes.length === 0 ? (
                    <p className="text-sm text-apple-secondary">Nenhuma mudança desde a última atualização do TCE.</p>
                  ) : (
                    <ul className="divide-y divide-black/[0.04] text-[12px] dark:divide-white/[0.06]">
                      {ultimasMovimentacoes.map((m, i) => (
                        <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span>
                            <span className="font-semibold text-apple-title">{m.municipio}</span>
                            <span className="text-apple-secondary">
                              {" "}· {m.campo}
                              {m.item ? ` › ${m.item}` : ""}
                              {m.competencia ? ` · ${m.competencia}` : ""}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-[11px] text-apple-muted">{formatarData(m.criado_em?.toDate())}</span>
                            <StatusBadge label={TIPO_MOV[m.tipo].label} tone={TIPO_MOV[m.tipo].tone} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Secao>
              </div>
            </div>

            <Secao titulo="Por competência" descricao="Módulos completos (regra de Status por Módulo) e ratificação geral, mês a mês">
              {dadosGraficos.length === 0 ? (
                <p className="text-sm text-apple-secondary">Nenhuma competência com dados capturados ainda.</p>
              ) : (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-[12px] font-semibold text-apple-title">Módulos completos</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dadosGraficos}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                          <XAxis dataKey="competencia" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="completos" name="Completos" stackId="mod" fill="var(--chart-bom)">
                            <LabelList dataKey="completos" position="inside" fill="#fff" fontSize={11} />
                          </Bar>
                          <Bar dataKey="pendentes" name="Pendentes" stackId="mod" fill="var(--chart-ruim)" radius={[4, 4, 0, 0]}>
                            <LabelList dataKey="pendentes" position="inside" fill="#fff" fontSize={11} formatter={(v: ReactNode) => (typeof v === "number" && v > 0 ? v : "")} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <LegendaBomRuim labelBom="Completos" labelRuim="Pendentes" />
                  </div>
                  <div>
                    <h3 className="mb-2 text-[12px] font-semibold text-apple-title">Ratificação geral</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dadosGraficos}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                          <XAxis dataKey="competencia" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="ratificados" name="Ratificados" stackId="ratif" fill="var(--chart-bom)">
                            <LabelList dataKey="ratificados" position="inside" fill="#fff" fontSize={11} />
                          </Bar>
                          <Bar dataKey="aRatificar" name="A ratificar" stackId="ratif" fill="var(--chart-ruim)" radius={[4, 4, 0, 0]}>
                            <LabelList dataKey="aRatificar" position="inside" fill="#fff" fontSize={11} formatter={(v: ReactNode) => (typeof v === "number" && v > 0 ? v : "")} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <LegendaBomRuim labelBom="Ratificados" labelRuim="A ratificar" />
                  </div>
                </div>
              )}
            </Secao>
          </>
        )}
      </main>
    </RequireAuth>
  );
}
