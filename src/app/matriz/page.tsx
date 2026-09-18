"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { exportCsv } from "@/lib/csv";
import RequireAuth from "@/components/RequireAuth";
import StatusBadge, { type Tone } from "@/components/StatusBadge";
import type { Municipio, StatusOperacionalAtual } from "@/types/municipio";

const MODULOS = [
  { key: "contabil", label: "Contábil" },
  { key: "folha", label: "Folha" },
  { key: "contratos", label: "Contratos" },
  { key: "tributos", label: "Tributos" },
] as const;

function moduloBadge(status: string | null | undefined) {
  if (!status) return <StatusBadge label="Não capturado ainda" tone="gray" />;
  return <StatusBadge label={status} tone="green" />;
}

function diasParaVencer(cndValidade: string | null | undefined): number | null {
  const match = cndValidade?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  const [, dia, mes, ano] = match;
  const vencimento = new Date(Number(ano), Number(mes) - 1, Number(dia));
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((vencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

function cndCountdownBadge(status: StatusOperacionalAtual | undefined) {
  if (!status?.cnd_status) return <StatusBadge label="Sem dado" tone="gray" />;
  const dias = diasParaVencer(status.cnd_validade);
  if (status.cnd_status === "irregular") return <StatusBadge label="Irregular" tone="red" />;
  if (dias === null) return <StatusBadge label="Regular" tone="green" />;
  const tone: Tone = dias < 0 ? "red" : dias <= 15 ? "yellow" : "green";
  const label = dias < 0 ? `Vencida há ${Math.abs(dias)}d` : `Vence em ${dias}d`;
  return <StatusBadge label={label} tone={tone} />;
}

export default function MatrizPage() {
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [statusPorIbge, setStatusPorIbge] = useState<Map<string, StatusOperacionalAtual>>(new Map());
  const [carregando, setCarregando] = useState(true);

  const { user } = useAuth();

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

  const linhas = useMemo(
    () =>
      municipios
        .map((m) => ({ municipio: m, status: statusPorIbge.get(m.codigo_ibge) }))
        .sort((a, b) => a.municipio.nome.localeCompare(b.municipio.nome, "pt-BR")),
    [municipios, statusPorIbge]
  );

  function exportar() {
    exportCsv(
      "matriz.csv",
      linhas.map(({ municipio, status }) => ({
        municipio: municipio.nome,
        contabil: status?.modulos?.contabil?.status ?? "",
        folha: status?.modulos?.folha?.status ?? "",
        contratos: status?.modulos?.contratos?.status ?? "",
        tributos: status?.modulos?.tributos?.status ?? "",
        cnd_status: status?.cnd_status ?? "",
        cnd_validade: status?.cnd_validade ?? "",
      }))
    );
  }

  return (
    <RequireAuth>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Matriz de Módulos &amp; CND</h1>
          <button
            onClick={exportar}
            className="rounded-full border border-black/[0.08] bg-white/80 px-3 py-1.5 text-[12px] font-semibold text-apple-title shadow-xs transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
          >
            Exportar CSV
          </button>
        </div>
        <p className="mb-4 text-sm text-apple-secondary">
          Status por área e monitor de validade da CND, por município.
        </p>

        {carregando ? (
          <p className="text-apple-secondary">Carregando...</p>
        ) : (
          <div className="apple-glass-card overflow-hidden rounded-[22px]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                    <th className="px-6 py-3">Município</th>
                    {MODULOS.map((m) => (
                      <th key={m.key} className="px-4 py-3">{m.label}</th>
                    ))}
                    <th className="px-6 py-3">CND</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                  {linhas.map(({ municipio, status }) => (
                    <tr key={municipio.codigo_ibge} className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                      <td className="px-6 py-3.5 font-semibold text-apple-title">{municipio.nome}</td>
                      {MODULOS.map((m) => (
                        <td key={m.key} className="px-4 py-3.5">
                          {moduloBadge(status?.modulos?.[m.key]?.status)}
                        </td>
                      ))}
                      <td className="px-6 py-3.5">{cndCountdownBadge(status)}</td>
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
