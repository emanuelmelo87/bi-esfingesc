// Mesma configuração pública já usada pelo app web (src/lib/firebase.ts) — não é segredo,
// vai igual no bundle JS do app web.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAr0SiWA1ZViyGwROPAnB3UYAYiUfzyyho",
  authDomain: "bi-esfingesc.firebaseapp.com",
  projectId: "bi-esfingesc",
  storageBucket: "bi-esfingesc.firebasestorage.app",
  messagingSenderId: "105816276065",
  appId: "1:105816276065:web:6ba21d667b928b94b4fe20",
};

export const ALLOWED_EMAIL_DOMAIN = "betha.com.br";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
