import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Radar e-Sfinge TCE & BI de Gestão",
  description: "Monitoramento do envio de dados e ratificações dos municípios catarinenses ao TCE-SC",
};

// Aplica o tema salvo antes da primeira pintura, evitando flash de tema errado.
const SCRIPT_TEMA = `
(function () {
  var tema = localStorage.getItem("tema") || "sistema";
  var escuro = tema === "escuro" || (tema === "sistema" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", escuro);
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col bg-apple-canvas text-apple-title tracking-[-0.012em]">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
