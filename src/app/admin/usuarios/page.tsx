"use client";

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, updateDoc, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
    <main className="flex-1 px-6 py-6">
      <h1 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Gestão de Usuários</h1>

      {carregando ? (
        <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 text-left text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">E-mail</th>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">Perfil</th>
                <th className="px-3 py-2">Canal primário</th>
                <th className="px-3 py-2">Ativo</th>
                <th className="px-3 py-2">Último login</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.email} className="border-t border-zinc-200 hover:bg-zinc-100/60 dark:border-zinc-800 dark:hover:bg-zinc-900/60">
                  <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{u.email}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{u.nome || "—"}</td>
                  <td className="px-3 py-2">
                    <select
                      value={u.perfil}
                      onChange={(e) => alterarPerfil(u.email, e.target.value as Perfil)}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    >
                      {PERFIS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{u.canal_primario ?? "—"}</td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={u.ativo}
                      onChange={(e) => alternarAtivo(u.email, e.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{formatarData(u.ultimo_login)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
