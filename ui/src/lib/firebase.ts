import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBrQQnGMQDgeZj2nsFKgvu792MsffR2Jmc",
  authDomain: "key-collective-568f8.firebaseapp.com",
  projectId: "key-collective-568f8",
  storageBucket: "key-collective-568f8.firebasestorage.app",
  messagingSenderId: "278286013841",
  appId: "1:278286013841:web:7c24ad101d4fbca211b630"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export { app, auth, googleProvider, signInWithPopup };
