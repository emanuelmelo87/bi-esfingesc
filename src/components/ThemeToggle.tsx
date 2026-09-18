"use client";

import { useEffect, useState } from "react";

type Tema = "claro" | "escuro" | "sistema";

function aplicarTema(tema: Tema) {
  const escuro =
    tema === "escuro" || (tema === "sistema" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", escuro);
}

export default function ThemeToggle() {
  const [tema, setTema] = useState<Tema>("sistema");

  useEffect(() => {
    const salvo = (localStorage.getItem("tema") as Tema | null) ?? "sistema";
    // localStorage não existe no SSR, então o valor real só é conhecido aqui —
    // sincronizar via efeito é o padrão correto, não um caso de "poderia ser derivado".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTema(salvo);
    aplicarTema(salvo);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem("tema") as Tema | null) === "sistema") aplicarTema("sistema");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function escolher(novoTema: Tema) {
    setTema(novoTema);
    localStorage.setItem("tema", novoTema);
    aplicarTema(novoTema);
  }

  const opcoes: { value: Tema; label: string }[] = [
    { value: "claro", label: "Claro" },
    { value: "escuro", label: "Escuro" },
    { value: "sistema", label: "Sistema" },
  ];

  return (
    <div className="flex items-center gap-[2px] rounded-[9px] bg-black/[0.05] p-[2px] text-[11px] font-medium text-apple-secondary dark:bg-white/[0.06]">
      {opcoes.map((o) => (
        <button
          key={o.value}
          onClick={() => escolher(o.value)}
          className={`rounded-[7px] px-2.5 py-0.5 transition-colors ${
            tema === o.value
              ? "bg-white text-apple-title shadow-xs ring-1 ring-black/[0.04] dark:bg-zinc-700 dark:text-white dark:ring-white/10"
              : "text-apple-secondary hover:text-apple-title"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
