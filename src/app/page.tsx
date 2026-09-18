"use client";

import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { user, loading, error, signIn, signOut } = useAuth();

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-zinc-400">Carregando...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50">
            Radar e-Sfinge TCE &amp; BI de Gestão
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Acesso restrito a colaboradores @betha.com.br
          </p>
        </div>
        <button
          onClick={signIn}
          className="rounded-full bg-[#6B1124] px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-[#82152c]"
        >
          Entrar com Google
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-zinc-50">
        Bem-vindo(a), {user.displayName ?? user.email}
      </h1>
      <p className="text-sm text-zinc-400">
        Portal em construção — Pipeline, Matriz de Módulos e Curva S entram aqui.
      </p>
      <button
        onClick={signOut}
        className="rounded-full border border-zinc-600 px-5 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
      >
        Sair
      </button>
    </main>
  );
}
