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
    <div className="flex gap-1 text-xs">
      {opcoes.map((o) => (
        <button
          key={o.value}
          onClick={() => escolher(o.value)}
          className={`rounded-full px-2 py-1 transition-colors ${
            tema === o.value
              ? "bg-vinho text-white"
              : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
