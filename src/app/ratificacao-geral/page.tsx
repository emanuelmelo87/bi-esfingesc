"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { exportCsv } from "@/lib/csv";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import StatusBadge from "@/components/StatusBadge";
import ContadorResultados from "@/components/ContadorResultados";
import ChamadosIndicador from "@/components/ChamadosIndicador";
import { carregarChamados, chamadosPorMunicipio, type Chamado } from "@/lib/chamados";
import { IconFilter, IconRefresh, IconTrash } from "@/components/icons";
import { compararCompetencias } from "@/lib/competencia";
import { passaFiltroEnvio, ratifEnviado, ratifTitle, type FiltroEnvio } from "@/lib/ratificacao";
import type { Municipio } from "@/types/municipio";
import type { StatusPorCompetencia } from "@/types/competencia";

const URL_PAINEL_TCE = "https://paineistransparencia.tce.sc.gov.br/extensions/appRatificacoesGlobais/index.html";

function normalizarBusca(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

export default function RatificacaoGeralPage() {
  const { user, isAdmin } = useAuth();
  const [apagando, setApagando] = useState<string | null>(null);
  const [chamadosPorNome, setChamadosPorNome] = useState<Map<string, Chamado[]>>(new Map());

  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [historicoPorIbge, setHistoricoPorIbge] = useState<Map<string, Map<string, StatusPorCompetencia>>>(new Map());
  const [competencias, setCompetencias] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("Betha");
  const [filtroCanal, setFiltroCanal] = useState("todos");
  const [filtroAssociacao, setFiltroAssociacao] = useState("todos");
  const [filtroPorCompetencia, setFiltroPorCompetencia] = useState<Record<string, FiltroEnvio>>({});

  useEffect(() => {
    if (!user) return;
    getDocs(collection(db, "municipios")).then((snap) => {
      setMunicipios(snap.docs.map((d) => d.data() as Municipio));
    });
  }, [user]);

  // Busca pontual (getDocs) em vez de onSnapshot: os dados só mudam quando
  // alguém roda a extensão, não em tempo real — um "ouvinte ao vivo" nessa
  // coleção (que só cresce a cada competência nova) consumia cota do
  // Firestore à toa em cada visita à tela. Botão "Atualizar" recarrega.
  async function carregarStatus() {
    if (!user) return;
    setCarregando(true);
    // Chamados vêm de um arquivo externo: se ele falhar, a tela segue sem os ícones.
    carregarChamados()
      .then((feed) => setChamadosPorNome(chamadosPorMunicipio(feed.issues)))
      .catch(() => setChamadosPorNome(new Map()));
    const snap = await getDocs(collection(db, "status_por_competencia"));
    const vistas = new Set<string>();
    const porMunicipio = new Map<string, Map<string, StatusPorCompetencia>>();
    snap.forEach((d) => {
      const dados = d.data() as StatusPorCompetencia;
      vistas.add(dados.competencia);
      if (!porMunicipio.has(dados.codigo_ibge)) porMunicipio.set(dados.codigo_ibge, new Map());
      porMunicipio.get(dados.codigo_ibge)!.set(dados.competencia, dados);
    });
    setCompetencias([...vistas].sort(compararCompetencias));
    setHistoricoPorIbge(porMunicipio);
    setCarregando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregarStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function apagarCompetencia(competencia: string) {
    if (!window.confirm(`Apagar TODOS os dados de ${competencia}? Essa ação não pode ser desfeita.`)) return;
    setApagando(competencia);
    try {
      const snap = await getDocs(query(collection(db, "status_por_competencia"), where("competencia", "==", competencia)));
      const batch = writeBatch(db);
      snap.forEach((d) => batch.delete(d.ref));
      await batch.commit();

      setCompetencias((atual) => atual.filter((c) => c !== competencia));
      setHistoricoPorIbge((atual) => {
        const proximo = new Map(atual);
        for (const [ibge, porCompetencia] of proximo) {
          if (!porCompetencia.has(competencia)) continue;
          const semACompetencia = new Map(porCompetencia);
          semACompetencia.delete(competencia);
          proximo.set(ibge, semACompetencia);
        }
        return proximo;
      });
    } finally {
      setApagando(null);
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
        historico: historicoPorIbge.get(m.codigo_ibge),
      }))
      .filter(({ historico }) =>
        Object.entries(filtroPorCompetencia).every(([c, valor]) =>
          passaFiltroEnvio(historico?.get(c)?.ratificacao_status, valor)
        )
      )
      .sort((a, b) => a.municipio.nome.localeCompare(b.municipio.nome, "pt-BR"));
  }, [municipios, historicoPorIbge, busca, filtroFornecedor, filtroCanal, filtroAssociacao, filtroPorCompetencia]);

  function exportar() {
    exportCsv(
      "ratificacao-geral.csv",
      linhas.map(({ municipio, historico }) => {
        const linha: Record<string, string | number | null> = {
          municipio: municipio.nome,
        };
        for (const c of competencias) {
          linha[c] = ratifEnviado(historico?.get(c)?.ratificacao_status) ? "SIM" : "NÃO";
        }
        return linha;
      })
    );
  }

  const inputClass =
    "rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <RequireAuth>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Ratificação Geral</h1>
          <div className="flex items-center gap-2">
            <ContadorResultados mostrando={linhas.length} total={municipios.length} />
            <button
              onClick={carregarStatus}
              title="Atualizar dados"
              className="rounded-full border border-black/[0.08] bg-white/80 p-1.5 text-apple-title shadow-xs transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <IconRefresh className="h-4 w-4" />
            </button>
            <button
              onClick={exportar}
              className="rounded-full border border-black/[0.08] bg-white/80 px-3.5 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              Exportar CSV
            </button>
          </div>
        </div>
        <p className="mb-4 text-sm text-apple-secondary">
          Histórico de ratificação cruzando todas as competências, capturado automaticamente pela
          extensão a cada sincronização.
        </p>

        <div className="mb-4 flex flex-wrap gap-3">
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
        ) : (
          <div className="apple-glass-card overflow-hidden rounded-[22px]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                    <th className="px-6 py-3">Município</th>
                    {competencias.map((c) => {
                      const filtro = filtroPorCompetencia[c] ?? "todos";
                      return (
                        <th
                          key={c}
                          className={`px-3 py-2 text-center whitespace-nowrap ${filtro !== "todos" ? "bg-vinho/[0.06] dark:bg-rose-400/10" : ""}`}
                        >
                          <div className="flex items-center justify-center gap-1">
                            {isAdmin ? (
                              <button
                                type="button"
                                onClick={() => apagarCompetencia(c)}
                                disabled={apagando === c}
                                title={`Apagar todos os dados de ${c}`}
                                className="group inline-flex items-center gap-1 rounded-full px-1 py-0.5 transition hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
                              >
                                {c}
                                <IconTrash className="h-3 w-3 text-apple-muted opacity-0 transition group-hover:opacity-100 group-hover:text-red-600 dark:group-hover:text-red-400" />
                              </button>
                            ) : (
                              <span>{c}</span>
                            )}
                          </div>
                          <label className="relative mt-1 inline-flex items-center">
                            <IconFilter
                              className={`pointer-events-none absolute left-1 h-2.5 w-2.5 ${filtro !== "todos" ? "text-vinho dark:text-rose-400" : "text-apple-muted"}`}
                            />
                            <select
                              value={filtro}
                              onChange={(e) =>
                                setFiltroPorCompetencia((atual) => ({ ...atual, [c]: e.target.value as FiltroEnvio }))
                              }
                              title={`Filtrar por ${c}`}
                              className="cursor-pointer rounded-full border border-black/[0.08] bg-white/90 py-0.5 pr-1.5 pl-4 text-[10px] font-normal normal-case text-apple-title shadow-xs dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                            >
                              <option value="todos">Todos</option>
                              <option value="sim">SIM</option>
                              <option value="nao">NÃO</option>
                            </select>
                          </label>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                  {linhas.map(({ municipio, historico }) => (
                    <tr key={municipio.codigo_ibge} className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                      <td className="px-6 py-3.5 font-semibold whitespace-nowrap text-apple-title">
                        {municipio.nome}
                        <ChamadosIndicador lista={chamadosPorNome.get(municipio.nome_busca)} />
                      </td>
                      {competencias.map((c) => {
                        const dado = historico?.get(c);
                        const enviado = ratifEnviado(dado?.ratificacao_status);
                        const titulo =
                          ratifTitle(dado?.ratificacao_status, dado?.ratificacao_data_envio) ??
                          `Conferir no painel do TCE-SC: busque por "${municipio.nome}", competência ${c}`;
                        return (
                          <td key={c} className="px-3 py-3.5 text-center">
                            {dado ? (
                              <Link
                                href={URL_PAINEL_TCE}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={titulo}
                                className="inline-block transition hover:opacity-70"
                              >
                                <StatusBadge label={enviado ? "SIM" : "NÃO"} tone={enviado ? "green" : "red"} />
                              </Link>
                            ) : (
                              <span className="text-apple-muted">—</span>
                            )}
                          </td>
                        );
                      })}
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
