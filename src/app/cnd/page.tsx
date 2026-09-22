"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { exportCsv } from "@/lib/csv";
import RequireAuth from "@/components/RequireAuth";
import StatusBadge, { type Tone } from "@/components/StatusBadge";
import FonteDados from "@/components/FonteDados";
import ContadorResultados from "@/components/ContadorResultados";
import type { Municipio, StatusOperacionalAtual } from "@/types/municipio";

function diasParaVencer(cndValidade: string | null | undefined): number | null {
  const match = cndValidade?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  const [, dia, mes, ano] = match;
  const vencimento = new Date(Number(ano), Number(mes) - 1, Number(dia));
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((vencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

function cndBadge(status: StatusOperacionalAtual | undefined) {
  if (!status?.cnd_status) return <StatusBadge label="Sem dado" tone="gray" />;
  const dias = diasParaVencer(status.cnd_validade);
  if (status.cnd_status === "irregular") return <StatusBadge label="Irregular" tone="red" />;
  if (dias === null) return <StatusBadge label="Regular" tone="green" />;
  const tone: Tone = dias < 0 ? "red" : dias <= 15 ? "yellow" : "green";
  const label = dias < 0 ? `Vencida há ${Math.abs(dias)}d` : `Vence em ${dias}d`;
  return <StatusBadge label={label} tone={tone} />;
}

type CategoriaCnd = "irregular" | "vencida" | "vencendo" | "regular" | "sem_dado";

function categoriaCnd(status: StatusOperacionalAtual | undefined): CategoriaCnd {
  if (!status?.cnd_status) return "sem_dado";
  if (status.cnd_status === "irregular") return "irregular";
  const dias = diasParaVencer(status.cnd_validade);
  if (dias === null) return "regular";
  if (dias < 0) return "vencida";
  if (dias <= 15) return "vencendo";
  return "regular";
}

const CATEGORIAS_CND: { value: CategoriaCnd; label: string }[] = [
  { value: "irregular", label: "Irregular" },
  { value: "vencida", label: "Vencida" },
  { value: "vencendo", label: "Vencendo em 15d" },
  { value: "regular", label: "Regular" },
  { value: "sem_dado", label: "Sem dado" },
];

type Aba = "geral" | "ranking";
type Faixa = "top10" | "top30";

function normalizarBusca(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

export default function CndPage() {
  const { user } = useAuth();
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [statusPorIbge, setStatusPorIbge] = useState<Map<string, StatusOperacionalAtual>>(new Map());
  const [carregando, setCarregando] = useState(true);

  const [aba, setAba] = useState<Aba>("geral");

  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("Betha");
  const [filtroCanal, setFiltroCanal] = useState("todos");
  const [filtroAssociacao, setFiltroAssociacao] = useState("todos");
  const [filtroCnd, setFiltroCnd] = useState("todos");

  const [faixa, setFaixa] = useState<Faixa>("top30");
  const [filtroEmpresa, setFiltroEmpresa] = useState("todas");

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
      setCarregando(false);
    });
    return unsub;
  }, [user]);

  // Aba Geral — todos os 295, com filtros e CND.
  const geral = useMemo(
    () =>
      municipios
        .map((m) => ({ municipio: m, status: statusPorIbge.get(m.codigo_ibge) }))
        .sort((a, b) => a.municipio.nome.localeCompare(b.municipio.nome, "pt-BR")),
    [municipios, statusPorIbge]
  );

  const canaisDisponiveis = useMemo(
    () => [...new Set(municipios.map((m) => m.canal_atendimento).filter((c): c is string => !!c))].sort(),
    [municipios]
  );

  const associacoesDisponiveis = useMemo(
    () => [...new Set(municipios.map((m) => m.sigla_associacao).filter((a): a is string => !!a))].sort(),
    [municipios]
  );

  const termoBusca = normalizarBusca(busca);
  const geralFiltrado = geral.filter(({ municipio, status }) => {
    if (termoBusca && !municipio.nome_busca.includes(termoBusca)) return false;
    if (filtroFornecedor !== "todos" && (municipio.fornecedor ?? "") !== filtroFornecedor) return false;
    if (filtroCanal !== "todos" && (municipio.canal_atendimento ?? "") !== filtroCanal) return false;
    if (filtroAssociacao !== "todos" && (municipio.sigla_associacao ?? "") !== filtroAssociacao) return false;
    if (filtroCnd !== "todos" && categoriaCnd(status) !== filtroCnd) return false;
    return true;
  });

  // Aba Ranking — só quem tem população, ordenado, Top 10/30.
  const ranking = useMemo(
    () =>
      municipios
        .filter((m): m is Municipio & { populacao: number } => typeof m.populacao === "number")
        .sort((a, b) => b.populacao - a.populacao)
        .map((municipio, i) => ({
          posicao: i + 1,
          municipio,
          status: statusPorIbge.get(municipio.codigo_ibge),
          empresa: municipio.empresa_software ?? municipio.fornecedor ?? "Não classificado",
        })),
    [municipios, statusPorIbge]
  );

  const empresasDisponiveis = useMemo(
    () => [...new Set(ranking.map((r) => r.empresa))].sort(),
    [ranking]
  );

  const rankingFiltrado = ranking.filter((r) => {
    if (termoBusca && !r.municipio.nome_busca.includes(termoBusca)) return false;
    if (faixa === "top10" && r.posicao > 10) return false;
    if (faixa === "top30" && r.posicao > 30) return false;
    if (filtroEmpresa !== "todas" && r.empresa !== filtroEmpresa) return false;
    return true;
  });

  const semPopulacao = municipios.length - ranking.length;

  function exportar() {
    if (aba === "ranking") {
      exportCsv(
        "cnd-ranking.csv",
        rankingFiltrado.map((r) => ({
          posicao: r.posicao,
          municipio: r.municipio.nome,
          populacao: r.municipio.populacao,
          empresa: r.empresa,
          cnd_status: r.status?.cnd_status ?? "",
        }))
      );
      return;
    }
    exportCsv(
      "cnd-geral.csv",
      geralFiltrado.map(({ municipio, status }) => ({
        municipio: municipio.nome,
        fornecedor: municipio.fornecedor ?? "",
        canal_atendimento: municipio.canal_atendimento ?? "",
        sigla_associacao: municipio.sigla_associacao ?? "",
        cnd_status: status?.cnd_status ?? "",
      }))
    );
  }

  const inputClass =
    "rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <RequireAuth>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">CND</h1>
          <div className="flex items-center gap-2">
            <ContadorResultados
              mostrando={aba === "geral" ? geralFiltrado.length : rankingFiltrado.length}
              total={aba === "geral" ? municipios.length : ranking.length}
            />
            <button
              onClick={exportar}
              className="rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              Exportar CSV
            </button>
          </div>
        </div>
        <p className="mb-1 text-sm text-apple-secondary">
          Fornecedor, empresa de software e situação da CND por município — visão geral de todos
          os 295, ou o ranking por habitantes.
        </p>
        <FonteDados colecoes={["municipios", "status_operacional_atual"]} />

        <div className="mb-4 flex items-center gap-0.5 rounded-full border border-black/[0.08] bg-white/80 p-0.5 dark:border-white/10 dark:bg-white/5 w-fit">
          {([
            { value: "geral", label: "Geral" },
            { value: "ranking", label: "Ranking (Hab.)" },
          ] as const).map((a) => (
            <button
              key={a.value}
              onClick={() => setAba(a.value)}
              className={`rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
                aba === a.value ? "bg-vinho text-white" : "text-apple-secondary hover:text-apple-title"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>

        {aba === "geral" ? (
          <>
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
              <select value={filtroCnd} onChange={(e) => setFiltroCnd(e.target.value)} className={inputClass}>
                <option value="todos">CND: todas</option>
                {CATEGORIAS_CND.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
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
                        <th className="px-4 py-3">Fornecedor</th>
                        <th className="px-4 py-3">Canal</th>
                        <th className="px-4 py-3">Associação</th>
                        <th className="px-6 py-3">CND</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                      {geralFiltrado.map(({ municipio, status }) => (
                        <tr key={municipio.codigo_ibge} className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                          <td className="px-6 py-3.5 font-semibold text-apple-title">{municipio.nome}</td>
                          <td className="px-4 py-3.5 text-apple-secondary">{municipio.fornecedor ?? "Não classificado"}</td>
                          <td className="px-4 py-3.5 text-apple-secondary">{municipio.canal_atendimento ?? "Não classificado"}</td>
                          <td className="px-4 py-3.5 text-apple-secondary">{municipio.sigla_associacao ?? "—"}</td>
                          <td className="px-6 py-3.5">{cndBadge(status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-3">
              <div className="flex items-center gap-0.5 rounded-full border border-black/[0.08] bg-white/80 p-0.5 dark:border-white/10 dark:bg-white/5">
                {([
                  { value: "top10", label: "Top 10" },
                  { value: "top30", label: "Top 30" },
                ] as const).map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFaixa(f.value)}
                    className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                      faixa === f.value
                        ? "bg-vinho text-white"
                        : "text-apple-secondary hover:text-apple-title"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar município..."
                className={inputClass}
              />
              <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} className={inputClass}>
                <option value="todas">Empresa: todas</option>
                {empresasDisponiveis.map((e) => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
            <p className="mb-4 text-xs text-apple-muted">
              Ranking por número de habitantes.
              {semPopulacao > 0 && ` ${semPopulacao} município(s) ainda sem população cadastrada.`}
            </p>

            {carregando ? (
              <p className="text-apple-secondary">Carregando...</p>
            ) : (
              <div className="apple-glass-card overflow-hidden rounded-[22px]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                        <th className="px-6 py-3">#</th>
                        <th className="px-4 py-3">Município</th>
                        <th className="px-4 py-3">Habitantes</th>
                        <th className="px-4 py-3">Empresa</th>
                        <th className="px-6 py-3">CND</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                      {rankingFiltrado.map((r) => (
                        <tr key={r.municipio.codigo_ibge} className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                          <td className="px-6 py-3.5 text-apple-secondary">{r.posicao}º</td>
                          <td className="px-4 py-3.5 font-semibold text-apple-title">{r.municipio.nome}</td>
                          <td className="px-4 py-3.5 text-apple-secondary">
                            {r.municipio.populacao.toLocaleString("pt-BR")}
                          </td>
                          <td className="px-4 py-3.5 text-apple-secondary">{r.empresa}</td>
                          <td className="px-6 py-3.5">{cndBadge(r.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </RequireAuth>
  );
}
