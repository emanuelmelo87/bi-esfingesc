"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";
import StatTile from "@/components/StatTile";
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
    carregarMunicipios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <RequireAuth>
      <main className="flex-1 px-6 py-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Radar e-Sfinge</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">TCE-SC · Prestação de Contas</p>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
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

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Por fornecedor</h2>
                <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {porFornecedor.map(([nome, qtd]) => (
                    <li key={nome} className="flex justify-between">
                      <span>{nome}</span>
                      <span className="tabular-nums">{qtd}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Por canal de atendimento</h2>
                <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {porCanal.map(([nome, qtd]) => (
                    <li key={nome} className="flex justify-between">
                      <span>{nome}</span>
                      <span className="tabular-nums">{qtd}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
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
