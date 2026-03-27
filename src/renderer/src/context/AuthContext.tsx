import React, { createContext, useContext, useState, useEffect } from 'react'
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence,
    browserSessionPersistence
} from 'firebase/auth'
import { auth, db } from '../firebase'
import { doc, setDoc, getDoc } from 'firebase/firestore'

interface UserProfile {
    uid: string
    email: string | null
    role: 'admin' | 'po_officer' | 'delivery_officer' | 'production_officer' | 'marketing' | 'marketing_manager' | 'pre_press' | 'procurement' | 'production' | 'qc' | 'dispatch' | 'head'
    username?: string
    whatsappNumber?: string
}

interface AuthContextType {
    user: UserProfile | null
    loading: boolean
    // Updated signature to accept optional 'remember' boolean
    login: (email: string, password: string, remember?: boolean) => Promise<{ success: boolean; error?: string }>
    signup: (email: string, password: string, role: string, username: string, whatsappNumber: string) => Promise<{ success: boolean; error?: string }>
    logout: () => Promise<void>
    resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>
    isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                try {
                    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
                    if (userDoc.exists()) {
                        const userData = userDoc.data();
                        setUser({
                            uid: currentUser.uid,
                            email: currentUser.email,
                            role: userData.role || 'admin',
                            username: userData.username || currentUser.email,
                            whatsappNumber: userData.whatsappNumber
                        });
                        // Sync role to main process for background notifications
                        if (window.electron && window.electron.ipcRenderer) {
                            window.electron.ipcRenderer.send('set-user-role', userData.role || 'admin');
                        }
                    } else {
                        const role = 'admin';
                        setUser({
                            uid: currentUser.uid,
                            email: currentUser.email,
                            role: role,
                            username: currentUser.email || ''
                        });
                        if (window.electron && window.electron.ipcRenderer) {
                            window.electron.ipcRenderer.send('set-user-role', role);
                        }
                    }
                } catch (error) {
                    console.error("Error fetching user profile:", error);
                    const role = 'admin';
                    setUser({
                        uid: currentUser.uid,
                        email: currentUser.email,
                        role: role,
                        username: currentUser.email || ''
                    });
                    if (window.electron && window.electron.ipcRenderer) {
                        window.electron.ipcRenderer.send('set-user-role', role);
                    }
                }
            } else {
                setUser(null)
                // Clear role in main process
                if (window.electron && window.electron.ipcRenderer) {
                    window.electron.ipcRenderer.send('clear-user-role');
                }
            }
            setLoading(false)
        });

        return () => unsubscribe();
    }, []);

    // Updated login function to handle persistence
    const login = async (email: string, password: string, remember: boolean = true) => {
        if (!navigator.onLine) {
            return { success: false, error: "No internet connection. Cannot verify credentials." }
        }

        try {
            // Set persistence based on user preference
            await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
            await signInWithEmailAndPassword(auth, email, password)
            return { success: true }
        } catch (error: any) {
            console.error('Login failed:', error)
            let msg = "Login failed."
            if (error.code === 'auth/invalid-credential') msg = "Invalid email or password."
            else if (error.code === 'auth/network-request-failed') msg = "Network error. Check connection."
            return { success: false, error: msg }
        }
    }

    const signup = async (email: string, password: string, role: string, username: string, whatsappNumber: string) => {
        if (!navigator.onLine) {
            return { success: false, error: "No internet connection. Cannot create account." }
        }

        try {
            // Default to local persistence for new signups
            await setPersistence(auth, browserLocalPersistence);
            const userCredential = await createUserWithEmailAndPassword(auth, email, password)
            const newUser = userCredential.user

            await setDoc(doc(db, "users", newUser.uid), {
                username,
                role,
                email,
                whatsappNumber,
                createdAt: new Date().toISOString()
            })

            return { success: true }
        } catch (error: any) {
            console.error('Signup failed:', error)
            return { success: false, error: error.message }
        }
    }

    const logout = async () => {
        await signOut(auth)
        setUser(null)
        sessionStorage.clear() // Clear persistent grid states
    }

    const resetPassword = async (email: string) => {
        if (!navigator.onLine) {
            return { success: false, error: "No internet connection." }
        }
        try {
            // Dynamically import to avoid top-level issues if not used, though here fine.
            const { sendPasswordResetEmail } = await import('firebase/auth');
            await sendPasswordResetEmail(auth, email);
            return { success: true }
        } catch (error: any) {
            console.error('Reset password failed:', error)
            let msg = error.message;
            if (error.code === 'auth/user-not-found') msg = "No user found with this email."
            return { success: false, error: msg }
        }
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, signup, logout, resetPassword, isAuthenticated: !!user }}>
            {!loading && children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}