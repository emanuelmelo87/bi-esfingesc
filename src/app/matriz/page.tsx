"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
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

  return (
    <RequireAuth>
      <main className="flex-1 px-6 py-6">
        <h1 className="mb-1 text-xl font-semibold text-zinc-50">Matriz de Módulos &amp; CND</h1>
        <p className="mb-4 text-sm text-zinc-400">
          Status por área e monitor de validade da CND, por município.
        </p>

        {carregando ? (
          <p className="text-zinc-400">Carregando...</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-left text-zinc-400">
                <tr>
                  <th className="px-3 py-2">Município</th>
                  {MODULOS.map((m) => (
                    <th key={m.key} className="px-3 py-2">{m.label}</th>
                  ))}
                  <th className="px-3 py-2">CND</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ municipio, status }) => (
                  <tr key={municipio.codigo_ibge} className="border-t border-zinc-800 hover:bg-zinc-900/60">
                    <td className="px-3 py-2 text-zinc-100">{municipio.nome}</td>
                    {MODULOS.map((m) => (
                      <td key={m.key} className="px-3 py-2">
                        {moduloBadge(status?.modulos?.[m.key]?.status)}
                      </td>
                    ))}
                    <td className="px-3 py-2">{cndCountdownBadge(status)}</td>
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
