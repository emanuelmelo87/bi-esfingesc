"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { collection, getDocs } from "firebase/firestore";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";
import StatTile from "@/components/StatTile";
import ProportionBar from "@/components/ProportionBar";
import ContadorResultados from "@/components/ContadorResultados";
import { IconRefresh } from "@/components/icons";
import { todosModulosEnviados, type Municipio, type StatusOperacionalAtual } from "@/types/municipio";
import type { StatusPorCompetencia } from "@/types/competencia";
import { ratifEnviado } from "@/lib/ratificacao";
import { MESES_ABREV, compararCompetencias, mesDaCompetencia } from "@/lib/competencia";

function formatCompetenciaCurta(c: string) {
  return `${MESES_ABREV[mesDaCompetencia(c) - 1]}/${c.split("/")[1].slice(-2)}`;
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

export default function Home() {
  const { user } = useAuth();
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [statusPorIbge, setStatusPorIbge] = useState<Map<string, StatusOperacionalAtual>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [historicoPorIbge, setHistoricoPorIbge] = useState<Map<string, Map<string, StatusPorCompetencia>>>(new Map());
  const [competenciasDisponiveis, setCompetenciasDisponiveis] = useState<string[]>([]);
  const [filtroFornecedorGraficos, setFiltroFornecedorGraficos] = useState("Betha");

  async function carregarMunicipios() {
    if (!user) return;
    const snap = await getDocs(collection(db, "municipios"));
    setMunicipios(snap.docs.map((d) => d.data() as Municipio));
  }

  // Busca pontual (getDocs) em vez de onSnapshot: os dados só mudam quando
  // alguém roda a extensão, não em tempo real — um "ouvinte ao vivo" nessas
  // coleções (que só crescem a cada competência nova) consumia cota do
  // Firestore à toa em cada visita à tela.
  async function carregarStatus() {
    if (!user) return;
    const [statusSnap, competenciaSnap] = await Promise.all([
      getDocs(collection(db, "status_operacional_atual")),
      getDocs(collection(db, "status_por_competencia")),
    ]);

    const proximo = new Map<string, StatusOperacionalAtual>();
    statusSnap.forEach((d) => proximo.set(d.id, d.data() as StatusOperacionalAtual));
    setStatusPorIbge(proximo);

    const vistas = new Set<string>();
    const porMunicipio = new Map<string, Map<string, StatusPorCompetencia>>();
    competenciaSnap.forEach((d) => {
      const dados = d.data() as StatusPorCompetencia;
      vistas.add(dados.competencia);
      if (!porMunicipio.has(dados.codigo_ibge)) porMunicipio.set(dados.codigo_ibge, new Map());
      porMunicipio.get(dados.codigo_ibge)!.set(dados.competencia, dados);
    });
    setCompetenciasDisponiveis([...vistas].sort(compararCompetencias));
    setHistoricoPorIbge(porMunicipio);

    setAtualizadoEm(new Date());
    setCarregando(false);
  }

  async function atualizarTudo() {
    await Promise.all([carregarMunicipios(), carregarStatus()]);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    atualizarTudo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const status = useMemo(() => [...statusPorIbge.values()], [statusPorIbge]);
  const totalMunicipios = municipios.length;

  const monitorados = municipios.filter((m) => m.monitoramento_ativo !== false).length;
  const cndIrregular = status.filter((s) => s.cnd_status === "irregular").length;
  // Atrasado = enviado fora do prazo, já conta como resolvido; só "ausente" (nunca
  // enviado) é considerado pendente pra esse indicador.
  const ratificacaoAusente = status.filter((s) => s.ratificacao_status === "ausente").length;
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

  const municipiosParaGraficos = useMemo(
    () =>
      filtroFornecedorGraficos === "todos"
        ? municipios
        : municipios.filter((m) => (m.fornecedor ?? "") === filtroFornecedorGraficos),
    [municipios, filtroFornecedorGraficos]
  );

  const dadosGraficosCompetencia = useMemo(
    () =>
      competenciasDisponiveis.map((c) => {
        let enviados = 0;
        let ratificados = 0;
        for (const m of municipiosParaGraficos) {
          const dados = historicoPorIbge.get(m.codigo_ibge)?.get(c);
          if (todosModulosEnviados(dados?.modulos)) enviados++;
          if (ratifEnviado(dados?.ratificacao_status)) ratificados++;
        }
        const total = municipiosParaGraficos.length;
        return {
          competencia: formatCompetenciaCurta(c),
          enviados,
          pendentes: total - enviados,
          ratificados,
          aRatificar: total - ratificados,
        };
      }),
    [competenciasDisponiveis, municipiosParaGraficos, historicoPorIbge]
  );

  return (
    <RequireAuth>
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <section className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-vinho uppercase dark:text-blue-400">TCE-SC</span>
              <span className="h-1 w-1 rounded-full bg-black/20 dark:bg-white/20" />
              <span className="text-[11px] font-semibold tracking-wider text-apple-secondary uppercase">
                Prestação de Contas
              </span>
            </div>
            <h1 className="text-3xl leading-tight font-bold tracking-[-0.03em] text-apple-title sm:text-[34px]">
              BI eSfinge SC
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-apple-secondary">
              Envio de dados e ratificações dos municípios catarinenses ao TCE-SC
            </p>
          </div>
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/15 bg-emerald-500/[0.08] px-3 py-1.5 text-[12px] font-medium text-emerald-800 dark:text-emerald-400">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
              <span>
                {atualizadoEm
                  ? `Consultado ${atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} `
                  : "Carregando "}
              </span>
            </div>
            <button
              onClick={atualizarTudo}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition-all hover:bg-white active:scale-[0.98] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <IconRefresh className="h-3.5 w-3.5 text-apple-secondary" />
              Atualizar agora
            </button>
          </div>
        </section>

        {carregando ? (
          <p className="text-apple-secondary">Carregando...</p>
        ) : (
          <>
            <section aria-label="Indicadores chave" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  ratificacaoAusente > 0
                    ? { label: "Envio pendente", tone: "yellow" }
                    : { label: "Em dia", tone: "green" }
                }
                valor={ratificacaoAusente}
                label="sem ratificação enviada"
                tone={ratificacaoAusente > 0 ? "yellow" : "green"}
                footerLabel="Proporção da base"
                footerValor={pct(ratificacaoAusente)}
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

            <section aria-label="Envio e ratificação por competência" className="apple-glass-card rounded-[22px] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[11px] font-bold tracking-wider text-apple-muted uppercase">
                    Envio e ratificação por competência
                  </h2>
                  <p className="mt-0.5 text-[12px] text-apple-secondary">
                    Módulos (Contábil/Folha/Contratos/Tributos) e ratificação global, mês a mês
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ContadorResultados mostrando={municipiosParaGraficos.length} total={municipios.length} />
                  <select
                    value={filtroFornecedorGraficos}
                    onChange={(e) => setFiltroFornecedorGraficos(e.target.value)}
                    className="rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="todos">Fornecedor: todos</option>
                    <option value="Betha">Betha</option>
                    <option value="Concorrente">Concorrente</option>
                  </select>
                </div>
              </div>

              {dadosGraficosCompetencia.length === 0 ? (
                <p className="text-sm text-apple-secondary">Nenhuma competência com dados capturados ainda.</p>
              ) : (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-[12px] font-semibold text-apple-title">Status de Envio de Módulos</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dadosGraficosCompetencia}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                          <XAxis dataKey="competencia" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="enviados" name="Enviados" stackId="envio" fill="var(--chart-bom)" radius={[0, 0, 0, 0]}>
                            <LabelList dataKey="enviados" position="inside" fill="#fff" fontSize={11} />
                          </Bar>
                          <Bar dataKey="pendentes" name="Pendentes" stackId="envio" fill="var(--chart-ruim)" radius={[4, 4, 0, 0]}>
                            <LabelList dataKey="pendentes" position="inside" fill="#fff" fontSize={11} formatter={(v: ReactNode) => (typeof v === "number" && v > 0 ? v : "")} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <LegendaBomRuim labelBom="Enviados" labelRuim="Pendentes" />
                  </div>
                  <div>
                    <h3 className="mb-2 text-[12px] font-semibold text-apple-title">Municípios Ratificados e Qtd a Ratificar</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dadosGraficosCompetencia}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                          <XAxis dataKey="competencia" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                          <Tooltip />
                          <Bar dataKey="ratificados" name="Ratificados" stackId="ratif" fill="var(--chart-bom)" radius={[0, 0, 0, 0]}>
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
            </section>

            <section aria-label="Ações de acesso rápido" className="flex flex-wrap items-center gap-2.5">
              <Link
                href="/ratificacao-geral"
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-b from-vinho-hover to-vinho px-4 py-2 text-[13px] font-semibold text-white shadow-apple-btn ring-1 ring-white/20 transition hover:brightness-105 active:scale-[0.98]"
              >
                Ver Ratificação Geral
              </Link>
              <Link
                href="/matriz"
                className="inline-flex items-center justify-center rounded-full border border-black/[0.08] bg-white/80 px-4 py-2 text-[13px] font-medium text-apple-title shadow-apple-btn transition active:scale-[0.98] dark:border-white/10 dark:bg-white/5"
              >
                Ver Status por Módulo
              </Link>
              <Link
                href="/evolucao"
                className="inline-flex items-center justify-center rounded-full border border-black/[0.08] bg-white/80 px-4 py-2 text-[13px] font-medium text-apple-title shadow-apple-btn transition active:scale-[0.98] dark:border-white/10 dark:bg-white/5"
              >
                Ver Evolução
              </Link>
            </section>
          </>
        )}
      </main>
    </RequireAuth>
  );
}
