"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Municipio } from "@/types/municipio";

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
  const [mensagem, setMensagem] = useState<string | null>(null);

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

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Controle de Municípios</h1>
        <button
          onClick={recarregarListaIBGE}
          disabled={recarregando}
          className="rounded-full bg-gradient-to-b from-vinho-hover to-vinho px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-apple-btn ring-1 ring-white/20 transition hover:brightness-105 disabled:opacity-50"
        >
          {recarregando ? "Recarregando..." : "Recarregar lista oficial do IBGE"}
        </button>
      </div>
      {mensagem && <p className="mb-4 text-sm text-apple-secondary">{mensagem}</p>}

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
                  <th className="px-6 py-3">Monitoramento</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                {municipios.map((m) => (
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
