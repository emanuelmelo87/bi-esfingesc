// As mesmas funções do SDK web do Firestore que carga.js usa, em cima do
// firebase-admin. O build da nuvem troca "firebase/firestore" por este arquivo,
// então carga.js roda igual na extensão e aqui.
import { CollectionReference, FieldValue } from "firebase-admin/firestore";

export function collection(db, nome) {
  return db.collection(nome);
}

// doc(colecao) → id novo; doc(colecao, id); doc(db, colecao, id).
export function doc(a, b, c) {
  if (a instanceof CollectionReference) return b ? a.doc(b) : a.doc();
  return a.collection(b).doc(c);
}

export function where(campo, operador, valor) {
  return (q) => q.where(campo, operador, valor);
}

export function query(colecao, ...filtros) {
  return filtros.reduce((q, filtro) => filtro(q), colecao);
}

export function getDocs(q) {
  return q.get();
}

export function setDoc(ref, dados, opcoes) {
  return opcoes ? ref.set(dados, opcoes) : ref.set(dados);
}

export function updateDoc(ref, dados) {
  return ref.update(dados);
}

export function writeBatch(db) {
  return db.batch();
}

export function serverTimestamp() {
  return FieldValue.serverTimestamp();
}
