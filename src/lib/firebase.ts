import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getFirestore } from "firebase/firestore";

function getEnvValue(key: string, fallback: string): string {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[key]) {
      return String(import.meta.env[key]);
    }
  } catch {
    // Ignore in non-meta environments
  }
  try {
    if (typeof process !== "undefined" && process.env && process.env[key]) {
      return String(process.env[key]);
    }
  } catch {
    // Ignore in browser environments
  }
  return fallback;
}

const firebaseConfig = {
  apiKey: getEnvValue("VITE_FIREBASE_API_KEY", "AIzaSyBAW9CM6Z2Obcx6y_tULpmaos51H17d4yY"),
  authDomain: getEnvValue("VITE_FIREBASE_AUTH_DOMAIN", "kalschat.firebaseapp.com"),
  projectId: getEnvValue("VITE_FIREBASE_PROJECT_ID", "kalschat"),
  storageBucket: getEnvValue("VITE_FIREBASE_STORAGE_BUCKET", "kalschat.firebasestorage.app"),
  messagingSenderId: getEnvValue("VITE_FIREBASE_MESSAGING_SENDER_ID", "108477753638"),
  appId: getEnvValue("VITE_FIREBASE_APP_ID", "1:108477753638:web:d6f4d5c7f3282096a479e7"),
  measurementId: getEnvValue("VITE_FIREBASE_MEASUREMENT_ID", "G-M9ZC1260T1"),
};

export const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseStorage = getStorage(firebaseApp);
export const firebaseDb = getFirestore(firebaseApp);
