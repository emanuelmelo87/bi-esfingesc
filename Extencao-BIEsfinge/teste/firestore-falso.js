// Firestore em memória, só com o que carga.js usa — para o teste da carga.
// No globalThis para o teste enxergar o mesmo banco que o bundle da carga usa.
export const banco = (globalThis.__bancoFalso ??= new Map()); // "colecao/id" -> dados
let seq = 0;

export function collection(_db, nome) {
  return { tipo: "colecao", nome };
}
export function doc(a, b, c) {
  if (a && a.tipo === "colecao") return { colecao: a.nome, id: b || "auto" + ++seq };
  return { colecao: b, id: c };
}
export function where(campo, _op, valor) {
  return { campo, valor };
}
export function query(col, ...filtros) {
  return { tipo: "colecao", nome: col.nome, filtros };
}
export async function getDocs(q) {
  const docs = [];
  for (const [chave, dados] of banco) {
    const [colecao, id] = chave.split("/");
    if (colecao !== q.nome) continue;
    if ((q.filtros || []).some((f) => dados[f.campo] !== f.valor)) continue;
    docs.push({ id, data: () => dados });
  }
  return { docs, forEach: (fn) => docs.forEach(fn) };
}
export async function setDoc(ref, dados, opcoes) {
  const chave = ref.colecao + "/" + ref.id;
  banco.set(chave, opcoes && opcoes.merge ? Object.assign({}, banco.get(chave), dados) : dados);
}
export async function updateDoc(ref, dados) {
  const chave = ref.colecao + "/" + ref.id;
  banco.set(chave, Object.assign({}, banco.get(chave), dados));
}
export function writeBatch() {
  const ops = [];
  return {
    set: (ref, dados, opcoes) => ops.push(() => setDoc(ref, dados, opcoes)),
    commit: async () => {
      for (const op of ops) await op();
    },
  };
}
export function serverTimestamp() {
  return "TS";
}
