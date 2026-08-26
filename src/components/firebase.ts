// Firebase initialization + Google auth helpers.
// A Firebase *web* config is a public client identifier (not a secret), so these
// values live inline — the same way Google's own docs ship them.
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'

// chip-hq project — "Continue with Google" is the only enabled sign-in provider.
const firebaseConfig = {
  apiKey: 'AIzaSyCqGDdLjDTgdTgprcK19daAFPSth6N4jdM',
  authDomain: 'chip-hq.firebaseapp.com',
  projectId: 'chip-hq',
  storageBucket: 'chip-hq.firebasestorage.app',
  messagingSenderId: '358690504566',
  appId: '1:358690504566:web:2b8623c8ef2cee5c2f8457',
  measurementId: 'G-15PEXTNV70',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

// Popup works on localhost without needing to configure OAuth redirect URIs
export const signInWithGoogle = () => signInWithPopup(auth, googleProvider)

export const logOut = () => signOut(auth)
