export function exportCsv(filename: string, rows: Record<string, string | number | null>[]): void {
  if (rows.length === 0) return;
  const colunas = Object.keys(rows[0]);
  const escapar = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = [
    colunas.join(","),
    ...rows.map((r) => colunas.map((c) => escapar(r[c])).join(",")),
  ];
  const csv = "﻿" + linhas.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
