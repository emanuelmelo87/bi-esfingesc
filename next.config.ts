import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Export estático: todo dado é buscado no cliente via Firestore, sem rotas
  // de servidor — dá pra hospedar como arquivos estáticos no Firebase Hosting.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
