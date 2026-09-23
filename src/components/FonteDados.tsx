import type { ReactNode } from "react";
import Link from "next/link";

const PROJETO_FIREBASE = "bi-esfingesc";

function urlColecao(colecao: string) {
  return `https://console.firebase.google.com/project/${PROJETO_FIREBASE}/firestore/data/~2F${colecao}`;
}

// Origem do dado no TCE (de onde a extensão captura), para quem quiser conferir.
export function FonteExterna({ url }: { url: string }) {
  return (
    <p className="mb-4 text-xs text-apple-muted">
      Fonte:{" "}
      <a href={url} target="_blank" rel="noopener noreferrer" className="break-all underline decoration-dotted hover:text-apple-secondary">
        {url}
      </a>
    </p>
  );
}

export default function FonteDados({ colecoes, extra }: { colecoes: string[]; extra?: ReactNode }) {
  return (
    <p className="mb-4 text-xs text-apple-muted">
      Fonte (Firestore):{" "}
      {colecoes.map((c, i) => (
        <span key={c}>
          <Link
            href={urlColecao(c)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted hover:text-apple-secondary"
          >
            {c}
          </Link>
          {i < colecoes.length - 1 ? ", " : ""}
        </span>
      ))}
      {extra ? <> · {extra}</> : null}
    </p>
  );
}
