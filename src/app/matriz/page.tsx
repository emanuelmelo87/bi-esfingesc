"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, onSnapshot, query, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { exportCsv } from "@/lib/csv";
import RequireAuth from "@/components/RequireAuth";
import StatusBadge from "@/components/StatusBadge";
import ContadorResultados from "@/components/ContadorResultados";
import { IconAlertTriangle, IconFilter, IconTrash } from "@/components/icons";
import { compararCompetencias } from "@/lib/competencia";
import { passaFiltroEnvio, ratifEnviado, ratifTitle, ratifTone, type FiltroEnvio } from "@/lib/ratificacao";
import type { Modulos, ModuloStatus, Municipio } from "@/types/municipio";
import type { StatusPorCompetencia } from "@/types/competencia";

const URL_PAINEL_TCE = "https://paineistransparencia.tce.sc.gov.br/extensions/appRatificacoesGlobais/index.html";

const MODULOS = [
  { key: "contabil", label: "Contábil" },
  { key: "folha", label: "Folha" },
  { key: "contratos", label: "Contratos" },
  { key: "tributos", label: "Tributos" },
] as const;

function moduloBadge(mod: ModuloStatus | null | undefined) {
  if (mod?.status === "ok") return <StatusBadge label="OK" tone="green" />;
  if (mod?.status === "pendente") {
    const titulo = mod.pendencias?.length
      ? mod.pendencias
          .map((p) => `${p.campo} (${p.entidade}): ${p.valor === null ? "não enviado" : p.valor} — precisa ${p.requisito}`)
          .join("\n")
      : "Pendente (sem detalhe — rode uma nova sincronização pra capturar)";
    return <StatusBadge label="Pendente" tone="yellow" title={titulo} />;
  }
  return <StatusBadge label="—" tone="gray" />;
}

// "ok" nos 4 módulos — diferente de todosModulosEnviados() (que só checa se o
// TCE reportou *algum* status, "ok" ou "pendente"); aqui é sobre ter passado
// mesmo na regra de negócio de cada área.
function todosModulosOk(modulos: Modulos | null | undefined) {
  if (!modulos) return false;
  return MODULOS.every((m) => modulos[m.key]?.status === "ok");
}

function normalizarBusca(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

function passaFiltroBooleano(valor: boolean, filtro: FiltroEnvio) {
  if (filtro === "todos") return true;
  return filtro === "sim" ? valor : !valor;
}

// Última competência (cronologicamente) que tem pelo menos um município com
// módulos capturados — evita abrir num mês em curso que ainda não tem dado.
function competenciaMaisRecenteComDados(
  competencias: string[],
  historicoPorIbge: Map<string, Map<string, StatusPorCompetencia>>
): string | null {
  for (let i = competencias.length - 1; i >= 0; i--) {
    const c = competencias[i];
    for (const porCompetencia of historicoPorIbge.values()) {
      if (porCompetencia.get(c)?.modulos) return c;
    }
  }
  return competencias[competencias.length - 1] ?? null;
}

export default function MatrizPage() {
  const { user, isAdmin } = useAuth();

  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [historicoPorIbge, setHistoricoPorIbge] = useState<Map<string, Map<string, StatusPorCompetencia>>>(new Map());
  const [competenciasDisponiveis, setCompetenciasDisponiveis] = useState<string[]>([]);
  const [competencia, setCompetencia] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [apagando, setApagando] = useState(false);

  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("todos");
  const [filtroCanal, setFiltroCanal] = useState("todos");
  const [filtroAssociacao, setFiltroAssociacao] = useState("todos");
  const [filtroRatificacao, setFiltroRatificacao] = useState<FiltroEnvio>("todos");
  const [filtroModulos, setFiltroModulos] = useState<FiltroEnvio>("todos");

  useEffect(() => {
    if (!user) return;
    getDocs(collection(db, "municipios")).then((snap) => {
      setMunicipios(snap.docs.map((d) => d.data() as Municipio));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, "status_por_competencia"), (snap) => {
      const vistas = new Set<string>();
      const porMunicipio = new Map<string, Map<string, StatusPorCompetencia>>();
      snap.forEach((d) => {
        const dados = d.data() as StatusPorCompetencia;
        vistas.add(dados.competencia);
        if (!porMunicipio.has(dados.codigo_ibge)) porMunicipio.set(dados.codigo_ibge, new Map());
        porMunicipio.get(dados.codigo_ibge)!.set(dados.competencia, dados);
      });
      const ordenadas = [...vistas].sort(compararCompetencias);
      setCompetenciasDisponiveis(ordenadas);
      setHistoricoPorIbge(porMunicipio);
      setCompetencia((atual) => atual ?? competenciaMaisRecenteComDados(ordenadas, porMunicipio));
      setCarregando(false);
    });
    return unsub;
  }, [user]);

  const indiceAtual = competencia ? competenciasDisponiveis.indexOf(competencia) : -1;

  async function apagarCompetenciaAtual() {
    if (!competencia) return;
    if (!window.confirm(`Apagar TODOS os dados de ${competencia}? Essa ação não pode ser desfeita.`)) return;
    setApagando(true);
    try {
      const snap = await getDocs(query(collection(db, "status_por_competencia"), where("competencia", "==", competencia)));
      const batch = writeBatch(db);
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      const restantes = competenciasDisponiveis.filter((c) => c !== competencia);
      setCompetenciasDisponiveis(restantes);
      setHistoricoPorIbge((atual) => {
        const proximo = new Map(atual);
        for (const [ibge, porCompetencia] of proximo) {
          if (!porCompetencia.has(competencia)) continue;
          const sem = new Map(porCompetencia);
          sem.delete(competencia);
          proximo.set(ibge, sem);
        }
        return proximo;
      });
      setCompetencia(competenciaMaisRecenteComDados(restantes, historicoPorIbge));
    } finally {
      setApagando(false);
    }
  }

  const canaisDisponiveis = useMemo(
    () => [...new Set(municipios.map((m) => m.canal_atendimento).filter((c): c is string => !!c))].sort(),
    [municipios]
  );

  const associacoesDisponiveis = useMemo(
    () => [...new Set(municipios.map((m) => m.sigla_associacao).filter((a): a is string => !!a))].sort(),
    [municipios]
  );

  const linhas = useMemo(() => {
    const termo = normalizarBusca(busca);
    return municipios
      .filter((m) => {
        if (termo && !m.nome_busca.includes(termo)) return false;
        if (filtroFornecedor !== "todos" && (m.fornecedor ?? "") !== filtroFornecedor) return false;
        if (filtroCanal !== "todos" && (m.canal_atendimento ?? "") !== filtroCanal) return false;
        if (filtroAssociacao !== "todos" && (m.sigla_associacao ?? "") !== filtroAssociacao) return false;
        return true;
      })
      .map((m) => ({
        municipio: m,
        dados: competencia ? historicoPorIbge.get(m.codigo_ibge)?.get(competencia) : undefined,
      }))
      .filter(({ dados }) => passaFiltroEnvio(dados?.ratificacao_status, filtroRatificacao))
      .filter(({ dados }) => passaFiltroBooleano(todosModulosOk(dados?.modulos), filtroModulos))
      .sort((a, b) => a.municipio.nome.localeCompare(b.municipio.nome, "pt-BR"));
  }, [municipios, historicoPorIbge, competencia, busca, filtroFornecedor, filtroCanal, filtroAssociacao, filtroRatificacao, filtroModulos]);

  function exportar() {
    exportCsv(
      `status-por-modulo-${competencia?.replace("/", "-") ?? "sem-competencia"}.csv`,
      linhas.map(({ municipio, dados }) => ({
        municipio: municipio.nome,
        ratificacao_geral: ratifEnviado(dados?.ratificacao_status) ? "SIM" : "NÃO",
        ratificacao_por_modulo: todosModulosOk(dados?.modulos) ? "SIM" : "NÃO",
        contabil: dados?.modulos?.contabil?.status ?? "",
        folha: dados?.modulos?.folha?.status ?? "",
        contratos: dados?.modulos?.contratos?.status ?? "",
        tributos: dados?.modulos?.tributos?.status ?? "",
      }))
    );
  }

  const inputClass =
    "rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <RequireAuth>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Status por Módulo</h1>
          <div className="flex items-center gap-2">
            <ContadorResultados mostrando={linhas.length} total={municipios.length} />
            <button
              onClick={exportar}
              className="rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              Exportar CSV
            </button>
          </div>
        </div>
        <p className="mb-4 text-sm text-apple-secondary">
          Status de envio por área (Contábil, Folha, Contratos, Tributos), por município e por
          competência. Dado consultado no TCE Virtual.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-full border border-black/[0.08] bg-white/90 py-1 pr-1.5 pl-1 shadow-xs dark:border-white/10 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => indiceAtual > 0 && setCompetencia(competenciasDisponiveis[indiceAtual - 1])}
              disabled={indiceAtual <= 0}
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
              {competenciasDisponiveis.length === 0 && <option value="">Sem competências</option>}
              {competenciasDisponiveis.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                indiceAtual >= 0 && indiceAtual < competenciasDisponiveis.length - 1 && setCompetencia(competenciasDisponiveis[indiceAtual + 1])
              }
              disabled={indiceAtual < 0 || indiceAtual >= competenciasDisponiveis.length - 1}
              className="rounded-full px-2 py-0.5 text-[13px] text-apple-secondary transition hover:bg-black/[0.04] disabled:opacity-30 dark:hover:bg-white/10"
              title="Próxima competência"
            >
              ›
            </button>
          </div>

          {isAdmin && competencia && (
            <button
              type="button"
              onClick={apagarCompetenciaAtual}
              disabled={apagando}
              title={`Apagar todos os dados de ${competencia}`}
              className="group inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-medium text-apple-secondary shadow-xs transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-red-950 dark:hover:text-red-400"
            >
              <IconTrash className="h-3.5 w-3.5" />
              Apagar {competencia}
            </button>
          )}

          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar município..."
            className={inputClass}
          />
          <select value={filtroFornecedor} onChange={(e) => setFiltroFornecedor(e.target.value)} className={inputClass}>
            <option value="todos">Fornecedor: todos</option>
            <option value="Betha">Betha</option>
            <option value="Concorrente">Concorrente</option>
          </select>
          <select value={filtroCanal} onChange={(e) => setFiltroCanal(e.target.value)} className={inputClass}>
            <option value="todos">Canal: todos</option>
            {canaisDisponiveis.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={filtroAssociacao} onChange={(e) => setFiltroAssociacao(e.target.value)} className={inputClass}>
            <option value="todos">Associação: todas</option>
            {associacoesDisponiveis.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {carregando ? (
          <p className="text-apple-secondary">Carregando...</p>
        ) : !competencia ? (
          <p className="text-apple-secondary">Nenhuma competência com dados capturados ainda.</p>
        ) : (
          <div className="apple-glass-card overflow-hidden rounded-[22px]">
            <div className="flex items-center gap-1.5 border-b border-black/[0.05] bg-amber-50/70 px-6 py-2 text-[11px] text-amber-800 dark:border-white/10 dark:bg-amber-500/[0.07] dark:text-amber-400">
              <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Linha destacada = todos os módulos enviados, mas a ratificação geral desta competência ainda não foi concluída no TCE.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                    <th className="px-6 py-3">Município</th>
                    <th className={`px-4 py-2 ${filtroRatificacao !== "todos" ? "bg-vinho/[0.06] dark:bg-rose-400/10" : ""}`}>
                      <div>Ratificação Geral</div>
                      <label className="relative mt-1 inline-flex items-center">
                        <IconFilter
                          className={`pointer-events-none absolute left-1 h-2.5 w-2.5 ${filtroRatificacao !== "todos" ? "text-vinho dark:text-rose-400" : "text-apple-muted"}`}
                        />
                        <select
                          value={filtroRatificacao}
                          onChange={(e) => setFiltroRatificacao(e.target.value as FiltroEnvio)}
                          title="Filtrar por Ratificação Geral"
                          className="cursor-pointer rounded-full border border-black/[0.08] bg-white/90 py-0.5 pr-1.5 pl-4 text-[10px] font-normal normal-case text-apple-title shadow-xs dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="todos">Todos</option>
                          <option value="sim">SIM</option>
                          <option value="nao">NÃO</option>
                        </select>
                      </label>
                    </th>
                    <th className={`px-4 py-2 ${filtroModulos !== "todos" ? "bg-vinho/[0.06] dark:bg-rose-400/10" : ""}`}>
                      <div>Ratificação por Módulo</div>
                      <label className="relative mt-1 inline-flex items-center">
                        <IconFilter
                          className={`pointer-events-none absolute left-1 h-2.5 w-2.5 ${filtroModulos !== "todos" ? "text-vinho dark:text-rose-400" : "text-apple-muted"}`}
                        />
                        <select
                          value={filtroModulos}
                          onChange={(e) => setFiltroModulos(e.target.value as FiltroEnvio)}
                          title="Filtrar por Ratificação por Módulo"
                          className="cursor-pointer rounded-full border border-black/[0.08] bg-white/90 py-0.5 pr-1.5 pl-4 text-[10px] font-normal normal-case text-apple-title shadow-xs dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          <option value="todos">Todos</option>
                          <option value="sim">SIM</option>
                          <option value="nao">NÃO</option>
                        </select>
                      </label>
                    </th>
                    {MODULOS.map((m) => (
                      <th key={m.key} className="px-4 py-3">{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                  {linhas.map(({ municipio, dados }) => {
                    const enviado = ratifEnviado(dados?.ratificacao_status);
                    // Situação real do envio: todos os módulos passaram, mas o TCE ainda
                    // não fechou a ratificação geral daquela competência — acontece porque
                    // são duas etapas independentes no e-Sfinge, uma não implica a outra.
                    const modulosOk = todosModulosOk(dados?.modulos);
                    const faltaSoRatificar = modulosOk && !enviado;
                    return (
                      <tr
                        key={municipio.codigo_ibge}
                        className={`transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] ${
                          faltaSoRatificar ? "bg-amber-50/70 dark:bg-amber-500/[0.07]" : ""
                        }`}
                      >
                        <td className="px-6 py-3.5 font-semibold text-apple-title">{municipio.nome}</td>
                        <td className="px-4 py-3.5">
                          {dados ? (
                            <Link
                              href={URL_PAINEL_TCE}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={
                                faltaSoRatificar
                                  ? "Todos os módulos foram enviados, mas a ratificação geral desta competência ainda não foi concluída no TCE."
                                  : ratifTitle(dados.ratificacao_status, dados.ratificacao_data_envio) ?? `Conferir no painel do TCE-SC: busque por "${municipio.nome}", competência ${competencia}`
                              }
                              className="inline-flex items-center gap-1.5 transition hover:opacity-70"
                            >
                              <StatusBadge label={enviado ? "SIM" : "NÃO"} tone={faltaSoRatificar ? "yellow" : ratifTone(dados.ratificacao_status)} />
                              {faltaSoRatificar && <IconAlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
                            </Link>
                          ) : (
                            <span className="text-apple-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge
                            label={modulosOk ? "SIM" : "NÃO"}
                            tone={modulosOk ? "green" : "red"}
                            title="SIM = os 4 módulos (Contábil/Folha/Contratos/Tributos) estão OK nesta competência"
                          />
                        </td>
                        {MODULOS.map((m) => (
                          <td key={m.key} className="px-4 py-3.5">
                            {moduloBadge(dados?.modulos?.[m.key])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </RequireAuth>
  );
}
