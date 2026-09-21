"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";
import FonteDados from "@/components/FonteDados";
import { ratifEnviado, ratifLabel } from "@/lib/ratificacao";
import type { Municipio, SnapshotDiario } from "@/types/municipio";

// Mesmo critério de "enviado" usado no resto do app (Home, Status por Módulo,
// Ratificação Geral): quitado (no prazo) ou atrasado já conta como concluído,
// só "ausente" (nunca enviado) fica pendente.
function isDone(s: SnapshotDiario): boolean {
  return ratifEnviado(s.ratificacao_status);
}

const RATIF_COR: Record<string, string> = {
  quitado: "#059669",
  atrasado: "#d97706",
  ausente: "#dc2626",
};

function mesAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

function mesAnterior(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function intervaloDoMes(mes: string): { inicio: string; fim: string; ultimoDia: number } {
  const [ano, m] = mes.split("-").map(Number);
  const ultimoDia = new Date(ano, m, 0).getDate();
  return { inicio: `${mes}-01`, fim: `${mes}-${String(ultimoDia).padStart(2, "0")}`, ultimoDia };
}

async function buscarSnapshotsDoMes(mes: string): Promise<SnapshotDiario[]> {
  const { inicio, fim } = intervaloDoMes(mes);
  const snap = await getDocs(
    query(collection(db, "snapshots_diarios"), where("data", ">=", inicio), where("data", "<=", fim))
  );
  return snap.docs.map((d) => d.data() as SnapshotDiario);
}

export default function EvolucaoPage() {
  const { user } = useAuth();
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [mes, setMes] = useState(mesAtual());
  const [overlay, setOverlay] = useState(false);
  const [snapshotsDoMes, setSnapshotsDoMes] = useState<SnapshotDiario[]>([]);
  const [snapshotsMesAnterior, setSnapshotsMesAnterior] = useState<SnapshotDiario[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState("");
  const [municipioSelecionado, setMunicipioSelecionado] = useState<Municipio | null>(null);
  const [timeline, setTimeline] = useState<SnapshotDiario[]>([]);

  useEffect(() => {
    if (!user) return;
    getDocs(collection(db, "municipios")).then((snap) => {
      setMunicipios(snap.docs.map((d) => d.data() as Municipio));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    buscarSnapshotsDoMes(mes).then((dados) => {
      setSnapshotsDoMes(dados);
      setCarregando(false);
    });
  }, [user, mes]);

  useEffect(() => {
    if (!user || !overlay) return;
    buscarSnapshotsDoMes(mesAnterior(mes)).then(setSnapshotsMesAnterior);
  }, [user, mes, overlay]);

  useEffect(() => {
    if (!user || !municipioSelecionado) return;
    const { inicio, fim } = intervaloDoMes(mes);
    getDocs(
      query(
        collection(db, "snapshots_diarios"),
        where("codigo_ibge", "==", municipioSelecionado.codigo_ibge),
        where("data", ">=", inicio),
        where("data", "<=", fim)
      )
    ).then((snap) => {
      setTimeline(
        snap.docs.map((d) => d.data() as SnapshotDiario).sort((a, b) => a.data.localeCompare(b.data))
      );
    });
  }, [user, municipioSelecionado, mes]);

  const totalMunicipios = municipios.length || 295;

  function curvaS(snapshots: SnapshotDiario[]) {
    const porDia = new Map<number, SnapshotDiario[]>();
    for (const s of snapshots) {
      const dia = Number(s.data.slice(8, 10));
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia)!.push(s);
    }
    return [...porDia.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dia, lista]) => ({
        dia,
        percentual: Math.round((lista.filter(isDone).length / totalMunicipios) * 1000) / 10,
      }));
  }

  const curvaAtual = useMemo(() => curvaS(snapshotsDoMes), [snapshotsDoMes, totalMunicipios]);
  const curvaAnterior = useMemo(() => curvaS(snapshotsMesAnterior), [snapshotsMesAnterior, totalMunicipios]);

  const dadosCurva = useMemo(() => {
    const dias = new Set([...curvaAtual.map((c) => c.dia), ...curvaAnterior.map((c) => c.dia)]);
    return [...dias].sort((a, b) => a - b).map((dia) => ({
      dia,
      atual: curvaAtual.find((c) => c.dia === dia)?.percentual ?? null,
      anterior: curvaAnterior.find((c) => c.dia === dia)?.percentual ?? null,
    }));
  }, [curvaAtual, curvaAnterior]);

  const volumeDiario = useMemo(() => {
    const porDia = new Map<number, Set<string>>();
    for (const s of snapshotsDoMes) {
      if (!isDone(s)) continue;
      const dia = Number(s.data.slice(8, 10));
      if (!porDia.has(dia)) porDia.set(dia, new Set());
      porDia.get(dia)!.add(s.codigo_ibge);
    }
    const dias = [...porDia.keys()].sort((a, b) => a - b);
    return dias.map((dia) => {
      if (dia === 1) return { dia, fechamentos: porDia.get(1)!.size, obs: "contagem bruta (dia 1)" };
      const hoje = porDia.get(dia)!;
      const ontem = porDia.get(dia - 1) ?? new Set<string>();
      const novos = [...hoje].filter((ibge) => !ontem.has(ibge)).length;
      return { dia, fechamentos: novos, obs: null };
    });
  }, [snapshotsDoMes]);

  const municipiosFiltrados = useMemo(() => {
    if (!busca.trim()) return [];
    const termo = busca.toUpperCase();
    return municipios
      .filter((m) => m.nome_busca.includes(termo) || m.codigo_ibge.includes(termo))
      .slice(0, 8);
  }, [busca, municipios]);

  return (
    <RequireAuth>
      <main className="flex-1 px-6 py-6">
        <h1 className="mb-1 text-2xl font-bold tracking-[-0.02em] text-apple-title">Evolução Temporal</h1>
        <p className="mb-1 text-sm text-apple-secondary">
          Histórico diário a partir dos snapshots — &ldquo;concluído&rdquo; = ratificação enviada (no
          prazo ou atrasada; só &ldquo;ausente&rdquo; fica pendente).
        </p>
        <FonteDados colecoes={["municipios", "snapshots_diarios"]} />

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <label className="flex items-center gap-1.5 text-sm text-apple-secondary">
            <input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} />
            Sobrepor mês anterior
          </label>
        </div>

        {carregando ? (
          <p className="text-apple-secondary">Carregando...</p>
        ) : (
          <div className="space-y-8">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-apple-title">
                Curva S — % de municípios concluídos por dia
              </h2>
              <div className="apple-glass-card h-72 rounded-[22px] p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dadosCurva}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                    <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} unit="%" />
                    <Tooltip />
                    {overlay && <Legend />}
                    <Line
                      type="monotone"
                      dataKey="atual"
                      name={mes}
                      stroke="#0861ff"
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                    {overlay && (
                      <Line
                        type="monotone"
                        dataKey="anterior"
                        name={mesAnterior(mes)}
                        stroke="#a1a1aa"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                        connectNulls
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-apple-title">
                Volume diário de fechamentos
              </h2>
              <p className="mb-2 text-xs text-apple-muted">
                Município que virou &quot;concluído&quot; naquele dia. O dia 1 mostra contagem bruta (sem
                comparação com o mês anterior).
              </p>
              <div className="apple-glass-card h-64 rounded-[22px] p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeDiario}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                    <XAxis dataKey="dia" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="fechamentos" fill="#0861ff" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-apple-title">
                Linha do tempo por município
              </h2>
              <p className="mb-2 text-xs text-apple-muted">
                Situação da ratificação geral capturada em cada snapshot diário do mês.
              </p>
              <div className="relative mb-3 max-w-sm">
                <input
                  placeholder="Buscar município por nome ou código IBGE..."
                  value={busca}
                  onChange={(e) => {
                    setBusca(e.target.value);
                    setMunicipioSelecionado(null);
                  }}
                  className="w-full rounded-full border border-black/[0.08] bg-white/90 px-3 py-1.5 text-[12px] text-apple-title shadow-xs focus:border-vinho focus:ring-1 focus:ring-vinho dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                />
                {municipiosFiltrados.length > 0 && !municipioSelecionado && (
                  <ul className="apple-glass-card absolute z-10 mt-1 w-full overflow-hidden rounded-2xl text-sm">
                    {municipiosFiltrados.map((m) => (
                      <li key={m.codigo_ibge}>
                        <button
                          onClick={() => {
                            setMunicipioSelecionado(m);
                            setBusca(m.nome);
                          }}
                          className="block w-full px-3 py-1.5 text-left text-apple-title hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                        >
                          {m.nome}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {municipioSelecionado && (
                <div className="apple-glass-card rounded-[22px] p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-apple-secondary">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: RATIF_COR.quitado }} />
                      Ratificado no prazo
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: RATIF_COR.atrasado }} />
                      Enviado fora do prazo
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: RATIF_COR.ausente }} />
                      Ausente
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-zinc-400" />
                      Sem dado
                    </span>
                  </div>
                  {timeline.length === 0 ? (
                    <p className="text-sm text-apple-secondary">
                      Sem snapshots para {municipioSelecionado.nome} neste mês.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {timeline.map((s) => (
                        <div
                          key={s.data}
                          title={`${s.data}: ${ratifLabel(s.ratificacao_status)}`}
                          className="flex h-8 w-8 items-center justify-center rounded text-xs font-medium text-white"
                          style={{ backgroundColor: s.ratificacao_status ? RATIF_COR[s.ratificacao_status] ?? "#71717a" : "#a1a1aa" }}
                        >
                          {Number(s.data.slice(8, 10))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </RequireAuth>
  );
}
