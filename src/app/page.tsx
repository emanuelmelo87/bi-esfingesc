"use client";

import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";

export default function Home() {
  const { user, signOut } = useAuth();

  return (
    <RequireAuth>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-zinc-50">
          Bem-vindo(a), {user?.displayName ?? user?.email}
        </h1>
        <p className="text-sm text-zinc-400">
          Use o menu acima para acessar o Pipeline ou a Matriz de Módulos.
        </p>
        <button
          onClick={signOut}
          className="rounded-full border border-zinc-600 px-5 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          Sair
        </button>
      </main>
    </RequireAuth>
  );
}
