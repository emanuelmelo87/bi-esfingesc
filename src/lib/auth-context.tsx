"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { ALLOWED_EMAIL_DOMAIN, auth, db, googleProvider } from "./firebase";
import type { Perfil } from "@/types/usuario";

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
  perfil: Perfil | null;
  isAdmin: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function isAllowedEmail(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser && !isAllowedEmail(firebaseUser.email)) {
        firebaseSignOut(auth);
        setUser(null);
        setError(`Acesso restrito a contas @${ALLOWED_EMAIL_DOMAIN}.`);
      } else {
        setUser(firebaseUser);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    // perfil só é lido quando user existe (RequireAuth barra tudo antes disso),
    // então não precisa resetar aqui — o próximo login já traz o perfil certo.
    if (!user?.email) return;
    const email = user.email.toLowerCase();
    const ref = doc(db, "usuarios", email);

    getDoc(ref).then((snap) => {
      if (!snap.exists()) {
        setDoc(ref, {
          email,
          nome: user.displayName ?? "",
          perfil: "LEITURA",
          canal_primario: null,
          ativo: true,
          criado_em: serverTimestamp(),
          ultimo_login: serverTimestamp(),
        });
      } else {
        updateDoc(ref, { ultimo_login: serverTimestamp() });
      }
    });

    const unsub = onSnapshot(ref, (snap) => {
      const dados = snap.data();
      if (dados?.ativo === false) {
        firebaseSignOut(auth);
        setUser(null);
        setPerfil(null);
        setError("Conta desativada. Fale com um administrador.");
        return;
      }
      setPerfil((dados?.perfil as Perfil | undefined) ?? null);
    });
    return unsub;
  }, [user]);

  async function signIn() {
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch {
      setError("Não foi possível entrar. Tente novamente.");
    }
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, error, perfil, isAdmin: perfil === "ADMIN_GERAL", signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
