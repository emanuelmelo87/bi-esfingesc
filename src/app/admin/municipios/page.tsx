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
    <main className="flex-1 px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Controle de Municípios</h1>
        <button
          onClick={recarregarListaIBGE}
          disabled={recarregando}
          className="rounded-md bg-vinho px-3 py-1.5 text-sm font-medium text-white hover:bg-vinho-hover disabled:opacity-50"
        >
          {recarregando ? "Recarregando..." : "Recarregar lista oficial do IBGE"}
        </button>
      </div>
      {mensagem && <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{mensagem}</p>}

      {carregando ? (
        <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">Município</th>
                <th className="px-3 py-2">Fornecedor</th>
                <th className="px-3 py-2">Canal de atendimento</th>
                <th className="px-3 py-2">Monitoramento</th>
              </tr>
            </thead>
            <tbody>
              {municipios.map((m) => (
                <tr key={m.codigo_ibge} className="border-t border-zinc-200 hover:bg-zinc-100/60 dark:border-zinc-800 dark:hover:bg-zinc-900/60">
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{m.nome}</td>
                  <td className="px-3 py-2">
                    <select
                      value={m.fornecedor ?? ""}
                      onChange={(e) => salvarCampo(m.codigo_ibge, "fornecedor", e.target.value || null)}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    >
                      <option value="">Não classificado</option>
                      <option value="Betha">Betha</option>
                      <option value="Concorrente">Concorrente</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      defaultValue={m.canal_atendimento ?? ""}
                      onBlur={(e) => salvarCampo(m.codigo_ibge, "canal_atendimento", e.target.value || null)}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </td>
                  <td className="px-3 py-2">
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
      )}
    </main>
  );
}
