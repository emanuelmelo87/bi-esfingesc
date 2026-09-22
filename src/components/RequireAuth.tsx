"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import ThemeToggle, { ThemeToggleCompact } from "@/components/ThemeToggle";
import NovidadesBalao from "@/components/NovidadesBalao";
import {
  IconBuilding,
  IconCertificate,
  IconGrid,
  IconHome,
  IconListChecks,
  IconMenu,
  IconShieldCheck,
  IconTrendingUp,
  IconUsers,
} from "@/components/icons";

const BASE_LINKS = [
  { href: "/", label: "Início", icon: IconHome },
  { href: "/matriz", label: "Status por Módulo", icon: IconGrid },
  { href: "/ratificacao-geral", label: "Ratificação Geral", icon: IconListChecks },
  { href: "/cnd", label: "CND", icon: IconCertificate },
  { href: "/evolucao", label: "Evolução", icon: IconTrendingUp },
];

const ADMIN_LINKS = [
  { href: "/admin/municipios", label: "Municípios", icon: IconBuilding, admin: true },
  { href: "/admin/usuarios", label: "Usuários", icon: IconUsers, admin: true },
  { href: "/admin/permissoes", label: "Permissões", icon: IconShieldCheck, admin: true },
];

function LogoMark() {
  return (
    <Image
      src="/esfinge-mark.png"
      alt="BI eSfinge SC"
      width={36}
      height={36}
      className="h-9 w-9 shrink-0 rounded-[10px] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_4px_14px_-2px_rgba(0,0,0,0.5)] ring-1 ring-white/10 transition-transform duration-200 ease-out hover:scale-105"
      priority
    />
  );
}

export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, error, signIn, isAdmin } = useAuth();
  const pathname = usePathname();

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

  function ItemNav({ link }: { link: (typeof links)[number] }) {
    const ativo = pathname === link.href;
    const isAdminLink = "admin" in link;
    return (
      <Link
        href={link.href}
        aria-label={link.label}
        className={`group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200 ease-out ${
          ativo
            ? "scale-105 bg-gradient-to-b from-vinho-hover to-vinho text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_4px_18px_-3px_rgba(190,18,60,0.65)]"
            : isAdminLink
              ? "text-blue-300/70 hover:scale-110 hover:bg-white/[0.08] hover:text-blue-200 active:scale-95"
              : "text-zinc-500 hover:scale-110 hover:bg-white/[0.08] hover:text-white active:scale-95"
        }`}
      >
        {ativo && <span className="absolute -left-[13px] h-5 w-[3px] rounded-full bg-gradient-to-b from-rose-300 to-vinho" />}
        <link.icon className="h-5 w-5" />
        <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-x-1 translate-y-[-50%] whitespace-nowrap rounded-lg bg-zinc-800 px-2.5 py-1.5 text-[12px] font-medium text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-all duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100">
          {link.label}
        </span>
      </Link>
    );
  }

  return (
    <div className="flex min-h-full flex-1">
      <aside className="sticky top-0 hidden h-screen w-[76px] shrink-0 flex-col items-center border-r border-white/[0.06] bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 py-5 shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)] lg:flex">
        <Link href="/" aria-label="BI eSfinge SC">
          <LogoMark />
        </Link>
        <nav aria-label="Navegação principal" className="mt-7 flex flex-col items-center gap-1.5">
          {BASE_LINKS.map((link) => (
            <ItemNav key={link.href} link={link} />
          ))}
          {isAdmin && (
            <>
              <div className="my-2 h-px w-7 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
              {ADMIN_LINKS.map((link) => (
                <ItemNav key={link.href} link={link} />
              ))}
            </>
          )}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-2">
          <NovidadesBalao variant="sidebar" />
          <ThemeToggleCompact />
          <div
            className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-zinc-600 to-zinc-500 text-[11px] font-semibold text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)] ring-1 ring-white/10 transition-transform duration-200 ease-out hover:scale-110"
            title={user.displayName ?? user.email ?? ""}
          >
            {iniciais}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-white/70 backdrop-blur-2xl lg:hidden dark:border-white/[0.06] dark:bg-zinc-900/70">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-2.5">
              <LogoMark />
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-[13px] font-bold tracking-tight text-apple-title">BI eSfinge SC</span>
                <span className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-apple-muted dark:bg-white/[0.06]">
                  TCE-SC
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <NovidadesBalao variant="mobile" />
              <div className="hidden sm:block">
                <ThemeToggle />
              </div>
              <details className="relative">
                <summary
                  aria-label="Abrir menu"
                  className="flex h-8 w-8 list-none items-center justify-center rounded-full text-apple-secondary hover:bg-black/[0.04] dark:hover:bg-white/[0.06] [&::-webkit-details-marker]:hidden"
                >
                  <IconMenu className="h-5 w-5" />
                </summary>
                <nav
                  aria-label="Navegação principal (mobile)"
                  className="absolute right-0 top-full z-50 mt-2 flex w-56 flex-col gap-0.5 rounded-2xl border border-black/[0.06] bg-white/95 p-1.5 shadow-lg backdrop-blur-xl dark:border-white/[0.08] dark:bg-zinc-900/95"
                >
                  {links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors ${
                        "admin" in link ? "text-vinho dark:text-blue-400" : ""
                      } ${
                        pathname === link.href
                          ? "bg-black/[0.05] text-apple-title dark:bg-white/[0.08] dark:text-white"
                          : "text-apple-secondary hover:bg-black/[0.04] hover:text-apple-title dark:hover:bg-white/[0.06]"
                      }`}
                      onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
                    >
                      <link.icon className="h-4 w-4 shrink-0" />
                      {link.label}
                    </Link>
                  ))}
                </nav>
              </details>
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
      </div>
    </div>
  );
}
