"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import ThemeToggle from "@/components/ThemeToggle";

const BASE_LINKS = [
  { href: "/", label: "Início" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/matriz", label: "Matriz de Módulos" },
  { href: "/evolucao", label: "Evolução" },
];

const ADMIN_LINKS = [
  { href: "/admin/municipios", label: "Municípios", admin: true },
  { href: "/admin/usuarios", label: "Usuários", admin: true },
  { href: "/admin/permissoes", label: "Permissões", admin: true },
];

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, error, signIn, isAdmin } = useAuth();

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-apple-secondary">Carregando...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold text-apple-title">
            BI eSfinge SC
          </h1>
          <p className="mt-2 text-sm text-apple-secondary">
            Acesso restrito a colaboradores @betha.com.br
          </p>
        </div>
        <button
          onClick={signIn}
          className="rounded-full bg-vinho px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-vinho-hover"
        >
          Entrar com Google
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </main>
    );
  }

  const links = isAdmin ? [...BASE_LINKS, ...ADMIN_LINKS] : BASE_LINKS;
  const iniciais = (user.displayName ?? user.email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-white/70 backdrop-blur-2xl dark:border-white/[0.06] dark:bg-zinc-900/70">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-7">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-gradient-to-b from-vinho-hover to-vinho text-white shadow-sm ring-1 ring-white/30">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-[13px] font-bold tracking-tight text-apple-title">BI eSfinge SC</span>
                <span className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-apple-muted dark:bg-white/[0.06]">
                  TCE-SC
                </span>
              </div>
            </div>
            <nav
              aria-label="Navegação principal"
              className="hidden items-center gap-0.5 rounded-full border border-black/[0.03] bg-black/[0.03] p-0.5 lg:flex dark:border-white/[0.05] dark:bg-white/[0.04]"
            >
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-full px-3 py-1 text-[12px] font-medium text-apple-secondary transition-colors hover:text-apple-title data-[admin=true]:text-vinho dark:data-[admin=true]:text-rose-400"
                  data-admin={"admin" in link ? link.admin : undefined}
                >
                  {link.label}
                  {"admin" in link && <span className="ml-1 text-[10px] font-normal text-apple-muted">(Admin)</span>}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block">
              <ThemeToggle />
            </div>
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-b from-zinc-600 to-zinc-800 text-[11px] font-semibold text-white shadow-xs ring-1 ring-black/10"
              title={user.displayName ?? user.email ?? ""}
            >
              {iniciais}
            </div>
          </div>
        </div>
      </header>
      {children}
      <footer className="mt-auto border-t border-black/[0.05] bg-white/60 py-4 text-[11px] text-apple-muted backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/60">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 sm:flex-row sm:px-6 lg:px-8">
          <span>
            <span className="font-semibold text-apple-title">BI eSfinge SC</span> · Ferramenta interna Betha para
            acompanhar a prestação de contas dos municípios de SC ao TCE-SC
          </span>
        </div>
      </footer>
    </>
  );
}
