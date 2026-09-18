"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

const BASE_LINKS = [
  { href: "/", label: "Início" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/matriz", label: "Matriz de Módulos" },
  { href: "/evolucao", label: "Evolução" },
];

const ADMIN_LINKS = [
  { href: "/admin/municipios", label: "Municípios (Admin)" },
  { href: "/admin/usuarios", label: "Usuários (Admin)" },
  { href: "/admin/permissoes", label: "Permissões (Admin)" },
];

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, error, signIn, isAdmin } = useAuth();

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
          className="rounded-full bg-vinho px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-vinho-hover"
        >
          Entrar com Google
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </main>
    );
  }

  const links = isAdmin ? [...BASE_LINKS, ...ADMIN_LINKS] : BASE_LINKS;

  return (
    <>
      <nav className="flex flex-wrap gap-4 border-b border-zinc-800 px-6 py-3 text-sm">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="text-zinc-300 hover:text-white">
            {link.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
