"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";
import StatusBadge from "@/components/StatusBadge";
import ContadorResultados from "@/components/ContadorResultados";
import { IconRefresh } from "@/components/icons";
import { compararCompetencias } from "@/lib/competencia";
import { ratifLabel, type RatificacaoStatus } from "@/lib/ratificacao";
import type { Municipio } from "@/types/municipio";
import type { Movimentacao, TipoMovimentacao } from "@/types/movimentacao";

const LIMITE = 1000;

const TIPO_BADGE: Record<TipoMovimentacao, { label: string; tone: "green" | "red" | "yellow" }> = {
  envio: { label: "Envio", tone: "green" },
  remocao: { label: "Remoção", tone: "red" },
  alteracao: { label: "Alteração", tone: "yellow" },
};

const CAMPOS = ["Ratificação Geral", "Contábil", "Folha", "Contratos", "Tributos", "CND"];

function normalizarBusca(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

function formatarDataHora(ts: Timestamp | null): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatarQuantidade(valor: string): string {
  if (valor === "não enviado") return "Não enviado";
  return `${valor} pacote${valor === "1" ? "" : "s"}`;
}

function formatarValor(m: Movimentacao, valor: string | null, detalhe: string | null): string {
  if (valor === null) return "Sem dado";
  if (m.fonte === "modulo_item") return valor === "ok" ? "Enviado" : valor.split(", ").map(formatarQuantidade).join(", ");
  let texto = valor;
  if (m.fonte === "ratificacao") texto = ratifLabel(valor as RatificacaoStatus);
  else if (m.fonte === "modulo") texto = valor === "ok" ? "OK" : "Pendente";
  else if (m.fonte === "cnd") texto = valor === "regular" ? "Regular" : "Irregular";
  return detalhe ? `${texto} (${detalhe})` : texto;
}

export default function MovimentacoesPage() {
  const { user } = useAuth();

  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);
  const [municipiosPorIbge, setMunicipiosPorIbge] = useState<Map<string, Municipio>>(new Map());
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("Betha");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | TipoMovimentacao>("todos");
  const [filtroCampo, setFiltroCampo] = useState("todos");
  const [filtroNivel, setFiltroNivel] = useState<"todos" | "area" | "item">("todos");
  const [filtroCompetencia, setFiltroCompetencia] = useState("todas");

  // Busca pontual + botão Atualizar, mesmo padrão das outras telas: o dado só
  // muda quando alguém roda a extensão.
  async function carregar() {
    if (!user) return;
    setCarregando(true);
    const [snapMov, snapMun] = await Promise.all([
      getDocs(query(collection(db, "movimentacoes"), orderBy("criado_em", "desc"), limit(LIMITE))),
      getDocs(collection(db, "municipios")),
    ]);
    setMovimentacoes(snapMov.docs.map((d) => d.data() as Movimentacao));
    setMunicipiosPorIbge(new Map(snapMun.docs.map((d) => {
      const m = d.data() as Municipio;
      return [m.codigo_ibge, m];
    })));
    setCarregando(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const competencias = useMemo(
    () => [...new Set(movimentacoes.map((m) => m.competencia).filter((c): c is string => !!c))].sort(compararCompetencias).reverse(),
    [movimentacoes]
  );

  const linhas = useMemo(() => {
    const termo = normalizarBusca(busca);
    return movimentacoes.filter((m) => {
      if (termo && !normalizarBusca(m.municipio).includes(termo)) return false;
      if (filtroFornecedor !== "todos" && (municipiosPorIbge.get(m.codigo_ibge)?.fornecedor ?? "") !== filtroFornecedor) return false;
      if (filtroTipo !== "todos" && m.tipo !== filtroTipo) return false;
      if (filtroCampo !== "todos" && m.campo !== filtroCampo) return false;
      if (filtroNivel !== "todos" && (m.fonte === "modulo_item") !== (filtroNivel === "item")) return false;
      if (filtroCompetencia !== "todas" && m.competencia !== filtroCompetencia) return false;
      return true;
    });
  }, [movimentacoes, municipiosPorIbge, busca, filtroFornecedor, filtroTipo, filtroCampo, filtroNivel, filtroCompetencia]);

  const inputClass =
    "rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <RequireAuth>
      <main className="w-full min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Movimentações</h1>
          <div className="flex items-center gap-2">
            <ContadorResultados mostrando={linhas.length} total={movimentacoes.length} label="movimentações" />
            <button
              onClick={carregar}
              title="Atualizar dados"
              className="rounded-full border border-black/[0.08] bg-white/80 p-1.5 text-apple-title shadow-xs transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <IconRefresh className="h-4 w-4" />
            </button>
          </div>
        </div>
        <p className="mb-4 text-sm text-apple-secondary">
          O que mudou a cada carga de dados: envios novos, remoções (ex.: ratificou e depois removeu) e
          alterações de situação ou data, comparando com o que já estava gravado. Mostra as{" "}
          {LIMITE} mais recentes.
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar município..." className={inputClass} />
          <select value={filtroFornecedor} onChange={(e) => setFiltroFornecedor(e.target.value)} className={inputClass}>
            <option value="todos">Fornecedor: todos</option>
            <option value="Betha">Betha</option>
            <option value="Concorrente">Concorrente</option>
          </select>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as "todos" | TipoMovimentacao)} className={inputClass}>
            <option value="todos">Movimento: todos</option>
            <option value="envio">Envio</option>
            <option value="remocao">Remoção</option>
            <option value="alteracao">Alteração</option>
          </select>
          <select value={filtroCampo} onChange={(e) => setFiltroCampo(e.target.value)} className={inputClass}>
            <option value="todos">Campo: todos</option>
            {CAMPOS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={filtroNivel} onChange={(e) => setFiltroNivel(e.target.value as "todos" | "area" | "item")} className={inputClass}>
            <option value="todos">Nível: todos</option>
            <option value="area">Área (status geral)</option>
            <option value="item">Item do módulo</option>
          </select>
          <select value={filtroCompetencia} onChange={(e) => setFiltroCompetencia(e.target.value)} className={inputClass}>
            <option value="todas">Competência: todas</option>
            {competencias.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {carregando ? (
          <p className="text-apple-secondary">Carregando...</p>
        ) : linhas.length === 0 ? (
          <p className="text-apple-secondary">
            {movimentacoes.length === 0
              ? "Nenhuma movimentação registrada ainda — elas passam a ser geradas a partir da próxima carga de dados."
              : "Nenhuma movimentação com esses filtros."}
          </p>
        ) : (
          <div className="apple-glass-card overflow-hidden rounded-[22px]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                    <th className="px-6 py-3">Detectado em</th>
                    <th className="px-4 py-3">Município</th>
                    <th className="px-4 py-3">Competência</th>
                    <th className="px-4 py-3">Campo</th>
                    <th className="px-4 py-3">Movimento</th>
                    <th className="px-4 py-3">Antes</th>
                    <th className="px-6 py-3">Depois</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                  {linhas.map((m, i) => (
                    <tr key={i} className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                      <td className="px-6 py-3.5 whitespace-nowrap text-apple-secondary">{formatarDataHora(m.criado_em)}</td>
                      <td className="px-4 py-3.5 font-semibold text-apple-title">{m.municipio}</td>
                      <td className="px-4 py-3.5 text-apple-secondary">{m.competencia ?? "—"}</td>
                      <td className="px-4 py-3.5 text-apple-secondary">
                        {m.campo}
                        {m.item && (
                          <span className="mt-0.5 block text-[11px] text-apple-muted" title={m.requisito ? `Exigência: ${m.requisito}` : undefined}>
                            {m.item}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <StatusBadge label={TIPO_BADGE[m.tipo].label} tone={TIPO_BADGE[m.tipo].tone} />
                      </td>
                      <td className="px-4 py-3.5 text-apple-secondary">{formatarValor(m, m.valor_anterior, m.detalhe_anterior)}</td>
                      <td className="px-6 py-3.5 text-apple-title">{formatarValor(m, m.valor_novo, m.detalhe_novo)}</td>
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
