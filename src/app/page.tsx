"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";
import StatTile from "@/components/StatTile";
import ProportionBar from "@/components/ProportionBar";
import type { Municipio, StatusOperacionalAtual } from "@/types/municipio";

export default function Home() {
  const { user } = useAuth();
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [statusPorIbge, setStatusPorIbge] = useState<Map<string, StatusOperacionalAtual>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);

  async function carregarMunicipios() {
    if (!user) return;
    const snap = await getDocs(collection(db, "municipios"));
    setMunicipios(snap.docs.map((d) => d.data() as Municipio));
  }

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
      setAtualizadoEm(new Date());
      setCarregando(false);
    });
    return unsub;
  }, [user]);

  const status = useMemo(() => [...statusPorIbge.values()], [statusPorIbge]);

  const monitorados = municipios.filter((m) => m.monitoramento_ativo !== false).length;
  const cndIrregular = status.filter((s) => s.cnd_status === "irregular").length;
  const ratificacaoAtrasada = status.filter((s) => s.ratificacao_status === "atrasado").length;
  const semAnalista = status.filter((s) => !s.analista).length;

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

  const totalMunicipios = municipios.length;

  return (
    <RequireAuth>
      <main className="flex-1 px-6 py-6">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-500">
              TCE-SC · Prestação de Contas
            </p>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Radar e-Sfinge</h1>
            <p className="mt-1 text-sm text-zinc-500 italic dark:text-zinc-500">
              Envio de dados e ratificações dos municípios catarinenses ao TCE-SC
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
            <span>
              {atualizadoEm
                ? `Atualizado ${atualizadoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} (dados ao vivo)`
                : "Carregando..."}
            </span>
            <button
              onClick={carregarMunicipios}
              className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Atualizar agora
            </button>
          </div>
        </div>

        {carregando ? (
          <p className="mt-6 text-zinc-600 dark:text-zinc-400">Carregando...</p>
        ) : (
          <>
            <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile valor={monitorados} label="municípios monitorados" />
              <StatTile valor={cndIrregular} label="com CND irregular" tone={cndIrregular > 0 ? "red" : "green"} />
              <StatTile
                valor={ratificacaoAtrasada}
                label="com ratificação atrasada"
                tone={ratificacaoAtrasada > 0 ? "red" : "green"}
              />
              <StatTile valor={semAnalista} label="sem analista atribuído" tone={semAnalista > 0 ? "yellow" : "green"} />
            </div>

            <div className="grid gap-x-8 gap-y-4 rounded-lg border border-zinc-200 bg-white p-4 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Por fornecedor</h2>
                <div className="space-y-1.5">
                  {porFornecedor.map(([nome, qtd]) => (
                    <ProportionBar key={nome} label={nome} valor={qtd} total={totalMunicipios} />
                  ))}
                </div>
              </div>
              <div>
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Por canal de atendimento</h2>
                <div className="space-y-1.5">
                  {porCanal.map(([nome, qtd]) => (
                    <ProportionBar key={nome} label={nome} valor={qtd} total={totalMunicipios} />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/pipeline"
                className="rounded-md bg-vinho px-4 py-2 text-sm font-medium text-white hover:bg-vinho-hover"
              >
                Ver Pipeline completo
              </Link>
              <Link
                href="/matriz"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Ver Matriz de Módulos
              </Link>
              <Link
                href="/evolucao"
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Ver Evolução
              </Link>
            </div>
          </>
        )}
      </main>
    </RequireAuth>
  );
}
