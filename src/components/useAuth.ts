import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { auth, signInWithGoogle, logOut as firebaseLogOut } from './firebase'

interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
  signIn: () => Promise<void>
  logOut: () => Promise<void>
}

// Tracks Firebase auth state and exposes sign-in / sign-out actions.
// `loading` starts true and flips false on the first auth callback, so a signed-in
// user landing on a reload never flashes the sign-in screen.
export function useFirebaseAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const signIn = useCallback(async () => {
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      // Ignore user-dismissed popup events
      if (
        e instanceof FirebaseError &&
        (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')
      ) {
        return
      }
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const logOut = useCallback(async () => {
    setError(null)
    try {
      await firebaseLogOut()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  return { user, loading, error, signIn, logOut }
}
