"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, updateDoc, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import FonteDados from "@/components/FonteDados";
import ContadorResultados from "@/components/ContadorResultados";
import type { Perfil, Usuario } from "@/types/usuario";

const PERFIS: Perfil[] = ["ADMIN_GERAL", "GESTOR_CANAL", "ANALISTA", "LEITURA"];

function formatarData(ts: Timestamp | undefined) {
  if (!ts) return "—";
  return ts.toDate().toLocaleString("pt-BR");
}

export default function AdminUsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "usuarios"), (snap) => {
      setUsuarios(
        snap.docs
          .map((d) => d.data() as Usuario)
          .sort((a, b) => a.email.localeCompare(b.email))
      );
      setCarregando(false);
    });
    return unsub;
  }, []);

  async function alterarPerfil(email: string, perfil: Perfil) {
    await updateDoc(doc(db, "usuarios", email), { perfil });
  }

  async function alternarAtivo(email: string, ativo: boolean) {
    await updateDoc(doc(db, "usuarios", email), { ativo });
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-apple-title">Gestão de Usuários</h1>
        <ContadorResultados mostrando={usuarios.length} total={usuarios.length} label="usuários" />
      </div>
      <FonteDados colecoes={["usuarios"]} />

      {carregando ? (
        <p className="text-apple-secondary">Carregando...</p>
      ) : (
        <div className="apple-glass-card overflow-hidden rounded-[22px]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.05] bg-black/[0.015] text-[11px] font-medium tracking-wider text-apple-muted uppercase dark:border-white/10 dark:bg-white/[0.02]">
                  <th className="px-6 py-3">E-mail</th>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Perfil</th>
                  <th className="px-4 py-3">Canal primário</th>
                  <th className="px-4 py-3">Ativo</th>
                  <th className="px-6 py-3">Último login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
                {usuarios.map((u) => (
                  <tr key={u.email} className="transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <td className="px-6 py-3.5 font-semibold text-apple-title">{u.email}</td>
                    <td className="px-4 py-3.5 text-apple-secondary">{u.nome || "—"}</td>
                    <td className="px-4 py-3.5">
                      <select
                        value={u.perfil}
                        onChange={(e) => alterarPerfil(u.email, e.target.value as Perfil)}
                        className="rounded-full border border-black/[0.08] bg-white/90 px-2.5 py-1 text-apple-title shadow-xs dark:border-white/10 dark:bg-zinc-800 dark:text-zinc-100"
                      >
                        {PERFIS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3.5 text-apple-secondary">{u.canal_primario ?? "—"}</td>
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={u.ativo}
                        onChange={(e) => alternarAtivo(u.email, e.target.checked)}
                      />
                    </td>
                    <td className="px-6 py-3.5 text-apple-secondary">{formatarData(u.ultimo_login)}</td>
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
