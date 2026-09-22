"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Municipio } from "@/types/municipio";
import clientesBetha from "@/data/clientes-betha.json";
import populacaoTop30 from "@/data/populacao-top30.json";
import FonteDados from "@/components/FonteDados";
import ContadorResultados from "@/components/ContadorResultados";

function normalizar(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export default function AdminMunicipiosPage() {
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [recarregando, setRecarregando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [importandoPopulacao, setImportandoPopulacao] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtroFornecedor, setFiltroFornecedor] = useState("Betha");
  const [filtroCanal, setFiltroCanal] = useState("todos");
  const [filtroAssociacao, setFiltroAssociacao] = useState("todos");

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    setCarregando(true);
    const snap = await getDocs(collection(db, "municipios"));
    setMunicipios(
      snap.docs
        .map((d) => d.data() as Municipio)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    );
    setCarregando(false);
  }

  async function salvarCampo(codigoIbge: string, campo: keyof Municipio, valor: unknown) {
    await updateDoc(doc(db, "municipios", codigoIbge), { [campo]: valor });
    setMunicipios((prev) =>
      prev.map((m) => (m.codigo_ibge === codigoIbge ? { ...m, [campo]: valor } : m))
    );
  }

  async function recarregarListaIBGE() {
    setRecarregando(true);
    setMensagem(null);
    try {
      const resp = await fetch(
        "https://servicodados.ibge.gov.br/api/v1/localidades/estados/42/municipios"
      );
      if (!resp.ok) throw new Error(`IBGE API respondeu ${resp.status}`);
      const dados: { id: number; nome: string }[] = await resp.json();

      const batch = writeBatch(db);
      for (const m of dados) {
        const codigoIbge = String(m.id);
        // Nunca inclui fornecedor/canal_atendimento/monitoramento_ativo aqui —
        // isso apagaria classificação já feita manualmente.
        batch.set(
          doc(db, "municipios", codigoIbge),
          { codigo_ibge: codigoIbge, nome: m.nome, nome_busca: normalizar(m.nome) },
          { merge: true }
        );
      }
      await batch.commit();
      setMensagem(`Lista recarregada: ${dados.length} municípios.`);
      await carregar();
    } catch (err) {
      setMensagem(`Erro ao recarregar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecarregando(false);
    }
  }

  async function importarClientesBetha() {
    setImportando(true);
    setMensagem(null);
    try {
      const porNomeBusca = new Map(municipios.map((m) => [m.nome_busca, m.codigo_ibge]));
      const batch = writeBatch(db);
      let importados = 0;
      const naoEncontrados: string[] = [];

      for (const c of clientesBetha) {
        const codigoIbge = porNomeBusca.get(normalizar(c.nome));
        if (!codigoIbge) {
          naoEncontrados.push(c.nome);
          continue;
        }
        batch.set(
          doc(db, "municipios", codigoIbge),
          {
            fornecedor: c.fornecedor === "Betha" ? "Betha" : "Concorrente",
            canal_atendimento: c.canal,
            sigla_associacao: c.sigla_associacao,
            associacao_regional: c.associacao_regional,
          },
          { merge: true }
        );
        importados++;
      }
      await batch.commit();
      setMensagem(
        naoEncontrados.length === 0
          ? `Planilha importada: ${importados} municípios atualizados.`
          : `Planilha importada: ${importados} atualizados. Não encontrados: ${naoEncontrados.join(", ")}.`
      );
      await carregar();
    } catch (err) {
      setMensagem(`Erro ao importar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportando(false);
    }
  }

  async function importarPopulacaoTop30() {
    setImportandoPopulacao(true);
    setMensagem(null);
    try {
      const porNomeBusca = new Map(municipios.map((m) => [m.nome_busca, m.codigo_ibge]));
      const batch = writeBatch(db);
      let importados = 0;
      const naoEncontrados: string[] = [];

      for (const p of populacaoTop30) {
        const codigoIbge = porNomeBusca.get(normalizar(p.nome));
        if (!codigoIbge) {
          naoEncontrados.push(p.nome);
          continue;
        }
        batch.set(
          doc(db, "municipios", codigoIbge),
          { populacao: p.populacao, empresa_software: p.empresa_software },
          { merge: true }
        );
        importados++;
      }
      await batch.commit();
      setMensagem(
        naoEncontrados.length === 0
          ? `População (top 30) importada: ${importados} municípios atualizados.`
          : `População importada: ${importados} atualizados. Não encontrados: ${naoEncontrados.join(", ")}.`
      );
      await carregar();
    } catch (err) {
      setMensagem(`Erro ao importar população: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportandoPopulacao(false);
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

  const municipiosFiltrados = useMemo(() => {
    const termo = normalizar(busca.trim());
    return municipios.filter((m) => {
      if (termo && !m.nome_busca.includes(termo)) return false;
      if (filtroFornecedor !== "todos" && (m.fornecedor ?? "") !== filtroFornecedor) return false;
      if (filtroCanal !== "todos" && (m.canal_atendimento ?? "") !== filtroCanal) return false;
      if (filtroAssociacao !== "todos" && (m.sigla_associacao ?? "") !== filtroAssociacao) return false;
      return true;
    });
  }, [municipios, busca, filtroFornecedor, filtroCanal, filtroAssociacao]);

  const inputClass =
    "rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Controle de Municípios</h1>
          <ContadorResultados mostrando={municipiosFiltrados.length} total={municipios.length} />
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={importarClientesBetha}
            disabled={importando || carregando}
            className="whitespace-nowrap rounded-full border border-black/[0.08] bg-white/80 px-3.5 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition hover:bg-white disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            {importando ? "Importando..." : "Importar Planilha"}
          </button>
          <button
            onClick={importarPopulacaoTop30}
            disabled={importandoPopulacao || carregando}
            className="whitespace-nowrap rounded-full border border-black/[0.08] bg-white/80 px-3.5 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition hover:bg-white disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            {importandoPopulacao ? "Importando..." : "Importar População (Top 30)"}
          </button>
          <button
            onClick={recarregarListaIBGE}
            disabled={recarregando}
            className="whitespace-nowrap rounded-full bg-gradient-to-b from-vinho-hover to-vinho px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-apple-btn ring-1 ring-white/20 transition hover:brightness-105 disabled:opacity-50"
          >
            {recarregando ? "Recarregando..." : "Recarregar IBGE"}
          </button>
        </div>
      </div>
      <FonteDados
        colecoes={["municipios"]}
        extra="Importar Planilha: data/clientes-betha.json e data/populacao-top30.json (arquivos locais) · Recarregar IBGE: servicodados.ibge.gov.br"
      />
      {mensagem && <p className="mb-4 text-sm text-apple-secondary">{mensagem}</p>}

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
                  <th className="px-4 py-3">Fornecedor</th>
                  <th className="px-4 py-3">Canal de atendimento</th>
                  <th className="px-4 py-3">Associação</th>
                  <th className="px-6 py-3">Monitoramento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                {municipiosFiltrados.map((m) => (
                  <tr key={m.codigo_ibge} className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <td className="px-6 py-3.5 font-semibold text-apple-title">{m.nome}</td>
                    <td className="px-4 py-3.5">
                      <select
                        value={m.fornecedor ?? ""}
                        onChange={(e) => salvarCampo(m.codigo_ibge, "fornecedor", e.target.value || null)}
                        className="rounded-full border border-black/[0.08] bg-white/90 px-2.5 py-1 text-apple-title shadow-xs dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        <option value="">Não classificado</option>
                        <option value="Betha">Betha</option>
                        <option value="Concorrente">Concorrente</option>
                      </select>
                    </td>
                    <td className="px-4 py-3.5">
                      <input
                        defaultValue={m.canal_atendimento ?? ""}
                        onBlur={(e) => salvarCampo(m.codigo_ibge, "canal_atendimento", e.target.value || null)}
                        className="rounded-full border border-black/[0.08] bg-white/90 px-2.5 py-1 text-apple-title shadow-xs dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                    </td>
                    <td className="px-4 py-3.5 text-apple-secondary" title={m.associacao_regional ?? ""}>
                      {m.sigla_associacao ?? "—"}
                    </td>
                    <td className="px-6 py-3.5">
                      <input
                        type="checkbox"
                        checked={m.monitoramento_ativo !== false}
                        onChange={(e) => salvarCampo(m.codigo_ibge, "monitoramento_ativo", e.target.checked)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
