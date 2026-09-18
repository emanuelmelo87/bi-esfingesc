"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import RequireAuth from "@/components/RequireAuth";

function AdminGate({ children }: { children: ReactNode }) {
  const { perfil, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (perfil !== null && !isAdmin) router.replace("/");
  }, [perfil, isAdmin, router]);

  if (perfil === null) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-zinc-400">Verificando permissões...</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-zinc-400">Acesso restrito.</p>
      </main>
    );
  }

  return <>{children}</>;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AdminGate>{children}</AdminGate>
    </RequireAuth>
  );
}
