"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { exportCsv } from "@/lib/csv";
import RequireAuth from "@/components/RequireAuth";
import StatusBadge from "@/components/StatusBadge";
import type { EtapaPipeline, Municipio, StatusOperacionalAtual } from "@/types/municipio";
import type { StatusPorCompetencia } from "@/types/competencia";

const ETAPAS: { value: EtapaPipeline; label: string }[] = [
  { value: "nao_iniciado", label: "Não iniciado" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "aguardando_cliente", label: "Aguardando cliente" },
  { value: "concluido", label: "Concluído" },
];

type Linha = {
  codigo_ibge: string;
  municipio: string;
  fornecedor: string | null;
  canal_atendimento: string | null;
  cnd_status: string | null;
  ratificacao_status: string | null;
  analista: string | null;
  etapa_pipeline: EtapaPipeline | null;
};

function cndBadge(status: string | null | undefined) {
  if (status === "regular") return <StatusBadge label="CND regular" tone="green" />;
  if (status === "irregular") return <StatusBadge label="CND irregular" tone="red" />;
  return <StatusBadge label="CND —" tone="gray" />;
}

function ratifBadge(status: string | null | undefined) {
  if (status === "quitado") return <StatusBadge label="Ratificado" tone="green" />;
  if (status === "atrasado") return <StatusBadge label="Atrasado" tone="red" />;
  if (status === "ausente") return <StatusBadge label="Ausente" tone="yellow" />;
  return <StatusBadge label="—" tone="gray" />;
}

export default function PipelinePage() {
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [statusPorIbge, setStatusPorIbge] = useState<Map<string, StatusOperacionalAtual>>(new Map());
  const [historicoPorIbge, setHistoricoPorIbge] = useState<Map<string, StatusPorCompetencia>>(new Map());
  const [carregando, setCarregando] = useState(true);

  const [competencia, setCompetencia] = useState(""); // "" = atual; "MM/AAAA" = histórico
  const [filtroCanal, setFiltroCanal] = useState("todos");
  const [filtroFornecedor, setFiltroFornecedor] = useState("todos");
  const [filtroEtapa, setFiltroEtapa] = useState("todos");

  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [loteAnalista, setLoteAnalista] = useState("");
  const [loteEquipe, setLoteEquipe] = useState("");
  const [loteEtapa, setLoteEtapa] = useState<EtapaPipeline | "">("");
  const [salvandoLote, setSalvandoLote] = useState(false);

  const { user, perfil } = useAuth();
  const usandoHistorico = competencia.trim() !== "";
  const podeEditar = perfil !== "LEITURA" && !usandoHistorico;

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

  useEffect(() => {
    if (!user || !usandoHistorico) return;
    const q = query(collection(db, "status_por_competencia"), where("competencia", "==", competencia.trim()));
    const unsub = onSnapshot(q, (snap) => {
      const proximo = new Map<string, StatusPorCompetencia>();
      snap.forEach((d) => {
        const dados = d.data() as StatusPorCompetencia;
        proximo.set(dados.codigo_ibge, dados);
      });
      setHistoricoPorIbge(proximo);
    });
    return unsub;
  }, [user, usandoHistorico, competencia]);

  const linhas: Linha[] = useMemo(
    () =>
      municipios.map((m) => {
        const atual = statusPorIbge.get(m.codigo_ibge);
        const historico = historicoPorIbge.get(m.codigo_ibge);
        return {
          codigo_ibge: m.codigo_ibge,
          municipio: m.nome,
          fornecedor: m.fornecedor,
          canal_atendimento: atual?.canal_atendimento_override ?? m.canal_atendimento,
          cnd_status: usandoHistorico ? null : atual?.cnd_status ?? null,
          ratificacao_status: usandoHistorico ? historico?.ratificacao_status ?? null : atual?.ratificacao_status ?? null,
          analista: usandoHistorico ? null : atual?.analista ?? null,
          etapa_pipeline: usandoHistorico ? null : atual?.etapa_pipeline ?? null,
        };
      }),
    [municipios, statusPorIbge, historicoPorIbge, usandoHistorico]
  );

  const canaisDisponiveis = useMemo(
    () => [...new Set(linhas.map((l) => l.canal_atendimento).filter((c): c is string => !!c))].sort(),
    [linhas]
  );

  const linhasFiltradas = linhas.filter((l) => {
    if (filtroCanal !== "todos" && (l.canal_atendimento ?? "") !== filtroCanal) return false;
    if (filtroFornecedor !== "todos" && (l.fornecedor ?? "") !== filtroFornecedor) return false;
    if (filtroEtapa !== "todos" && (l.etapa_pipeline ?? "") !== filtroEtapa) return false;
    return true;
  });

  function alternarSelecao(codigoIbge: string) {
    setSelecionados((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(codigoIbge)) proximo.delete(codigoIbge);
      else proximo.add(codigoIbge);
      return proximo;
    });
  }

  function alternarSelecaoTodos() {
    setSelecionados((prev) =>
      prev.size === linhasFiltradas.length ? new Set() : new Set(linhasFiltradas.map((l) => l.codigo_ibge))
    );
  }

  async function aplicarLote() {
    if (selecionados.size === 0) return;
    setSalvandoLote(true);
    try {
      const campos: Record<string, unknown> = { atualizado_em: serverTimestamp() };
      if (loteAnalista) campos.analista = loteAnalista;
      if (loteEquipe) campos.equipe = loteEquipe;
      if (loteEtapa) campos.etapa_pipeline = loteEtapa;

      const batch = writeBatch(db);
      selecionados.forEach((codigoIbge) => {
        batch.set(doc(db, "status_operacional_atual", codigoIbge), campos, { merge: true });
      });
      await batch.commit();
      setSelecionados(new Set());
      setLoteAnalista("");
      setLoteEquipe("");
      setLoteEtapa("");
    } finally {
      setSalvandoLote(false);
    }
  }

  function exportar() {
    exportCsv(
      usandoHistorico ? `pipeline_${competencia.trim().replace("/", "-")}.csv` : "pipeline.csv",
      linhasFiltradas.map((l) => ({
        municipio: l.municipio,
        fornecedor: l.fornecedor ?? "",
        canal_atendimento: l.canal_atendimento ?? "",
        cnd_status: l.cnd_status ?? "",
        ratificacao_status: l.ratificacao_status ?? "",
        analista: l.analista ?? "",
        etapa_pipeline: l.etapa_pipeline ?? "",
      }))
    );
  }

  const inputClass =
    "rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
  const loteInputClass =
    "rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

  return (
    <RequireAuth>
      <main className="flex-1 px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Pipeline — 295 Municípios{usandoHistorico ? ` (competência ${competencia.trim()})` : ""}
          </h1>
          <button
            onClick={exportar}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Exportar CSV
          </button>
        </div>

        <div className="mb-4 flex flex-wrap gap-3">
          <input
            placeholder="Competência (MM/AAAA) — vazio = atual"
            value={competencia}
            onChange={(e) => setCompetencia(e.target.value)}
            className={inputClass}
          />
          <select value={filtroCanal} onChange={(e) => setFiltroCanal(e.target.value)} className={inputClass}>
            <option value="todos">Canal: todos</option>
            {canaisDisponiveis.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={filtroFornecedor} onChange={(e) => setFiltroFornecedor(e.target.value)} className={inputClass}>
            <option value="todos">Fornecedor: todos</option>
            <option value="Betha">Betha</option>
            <option value="Concorrente">Concorrente</option>
          </select>
          <select value={filtroEtapa} onChange={(e) => setFiltroEtapa(e.target.value)} className={inputClass}>
            <option value="todos">Etapa: todas</option>
            {ETAPAS.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
        </div>

        {usandoHistorico && (
          <p className="mb-4 text-xs text-zinc-500">
            Visualização histórica (somente leitura) — CND, analista e etapa não existem por
            competência, só ratificação. Limpe o campo de competência para voltar ao estado atual
            e poder editar.
          </p>
        )}

        {selecionados.size > 0 && podeEditar && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-vinho bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{selecionados.size} selecionado(s):</span>
            <input
              placeholder="Analista"
              value={loteAnalista}
              onChange={(e) => setLoteAnalista(e.target.value)}
              className={loteInputClass}
            />
            <input
              placeholder="Equipe"
              value={loteEquipe}
              onChange={(e) => setLoteEquipe(e.target.value)}
              className={loteInputClass}
            />
            <select
              value={loteEtapa}
              onChange={(e) => setLoteEtapa(e.target.value as EtapaPipeline)}
              className={loteInputClass}
            >
              <option value="">Etapa (manter)</option>
              {ETAPAS.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
            <button
              onClick={aplicarLote}
              disabled={salvandoLote}
              className="rounded-md bg-vinho px-3 py-1 text-sm font-medium text-white hover:bg-vinho-hover disabled:opacity-50"
            >
              {salvandoLote ? "Aplicando..." : "Aplicar"}
            </button>
          </div>
        )}

        {carregando ? (
          <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-3 py-2">
                    {podeEditar && (
                      <input
                        type="checkbox"
                        checked={selecionados.size === linhasFiltradas.length && linhasFiltradas.length > 0}
                        onChange={alternarSelecaoTodos}
                      />
                    )}
                  </th>
                  <th className="px-3 py-2">Município</th>
                  <th className="px-3 py-2">Fornecedor</th>
                  <th className="px-3 py-2">Canal</th>
                  <th className="px-3 py-2">CND</th>
                  <th className="px-3 py-2">Ratificação</th>
                  <th className="px-3 py-2">Analista</th>
                  <th className="px-3 py-2">Etapa</th>
                </tr>
              </thead>
              <tbody>
                {linhasFiltradas.map((l) => (
                  <tr key={l.codigo_ibge} className="border-t border-zinc-200 hover:bg-zinc-100/60 dark:border-zinc-800 dark:hover:bg-zinc-900/60">
                    <td className="px-3 py-2">
                      {podeEditar && (
                        <input
                          type="checkbox"
                          checked={selecionados.has(l.codigo_ibge)}
                          onChange={() => alternarSelecao(l.codigo_ibge)}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{l.municipio}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      {l.fornecedor ?? "Não classificado"}
                    </td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      {l.canal_atendimento ?? "Não classificado"}
                    </td>
                    <td className="px-3 py-2">{cndBadge(l.cnd_status)}</td>
                    <td className="px-3 py-2">{ratifBadge(l.ratificacao_status)}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{l.analista ?? "—"}</td>
                    <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                      {ETAPAS.find((e) => e.value === l.etapa_pipeline)?.label ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </RequireAuth>
  );
}
