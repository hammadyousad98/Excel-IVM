import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/ExcelLogo.png'

export const Login: React.FC = () => {
    const [isLogin, setIsLogin] = useState(true)
    const [email, setEmail] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [whatsappNumber, setWhatsappNumber] = useState('')
    const [role, setRole] = useState('admin')
    const [rememberMe, setRememberMe] = useState(true) // Default to true
    const [error, setError] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isOnline, setIsOnline] = useState(navigator.onLine)

    const [showForgot, setShowForgot] = useState(false)
    const [resetEmail, setResetEmail] = useState('')
    const [resetStatus, setResetStatus] = useState<{ type: 'success' | 'error' | ''; msg: string }>({ type: '', msg: '' })
    const [showPassword, setShowPassword] = useState(false)

    const { login, signup, resetPassword } = useAuth()

    useEffect(() => {
        const handleStatus = () => setIsOnline(navigator.onLine);
        window.addEventListener('online', handleStatus);
        window.addEventListener('offline', handleStatus);
        return () => {
            window.removeEventListener('online', handleStatus);
            window.removeEventListener('offline', handleStatus);
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setIsLoading(true)

        if (!isOnline) {
            setError("You are offline. Please connect to the internet to log in.")
            setIsLoading(false)
            return
        }

        let result;
        if (isLogin) {
            result = await login(email, password, rememberMe)
        } else {
            result = await signup(email, password, role, username, whatsappNumber)
        }

        if (!result.success) {
            setError(result.error || 'Operation failed.')
        }
        setIsLoading(false)
    }

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        setResetStatus({ type: '', msg: '' })
        setIsLoading(true)

        if (!isOnline) {
            setResetStatus({ type: 'error', msg: "You are offline." })
            setIsLoading(false)
            return
        }

        const result = await resetPassword(resetEmail)
        if (result.success) {
            setResetStatus({ type: 'success', msg: "Password reset link sent! Check your email." })
        } else {
            setResetStatus({ type: 'error', msg: result.error || "Failed to send reset link." })
        }
        setIsLoading(false)
    }

    return (
        <div className="flex items-center justify-center h-screen bg-gray-100">
            <div className="p-8 bg-white rounded shadow-md w-96">
                <div className="flex justify-center mb-6">
                    <img src={logo} alt="Logo" className="h-20 w-auto object-contain" />
                </div>

                {!showForgot ? (
                    <>
                        <h2 className="mb-6 text-2xl font-bold text-center text-gray-800">
                            {isLogin ? 'Login' : 'Sign Up'}
                        </h2>

                        {!isOnline && (
                            <div className="mb-4 p-3 bg-yellow-100 text-yellow-800 rounded text-sm border border-yellow-200">
                                <strong>⚠️ Offline Mode</strong>
                                <p>You cannot sign in with new credentials while offline.</p>
                            </div>
                        )}

                        {error && <p className="mb-4 text-sm text-red-500 bg-red-50 p-2 rounded border border-red-100">{error}</p>}

                        <form onSubmit={handleSubmit}>
                            {!isLogin && (
                                <>
                                    <div className="mb-4">
                                        <label className="block mb-2 text-sm font-bold text-gray-700">Username (Display Name)</label>
                                        <input
                                            type="text"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            className="w-full px-3 py-2 border rounded shadow appearance-none text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                            required={!isLogin}
                                        />
                                    </div>
                                    <div className="mb-4">
                                        <label className="block mb-2 text-sm font-bold text-gray-700">WhatsApp Number (e.g. 923001234567)</label>
                                        <input
                                            type="text"
                                            value={whatsappNumber}
                                            onChange={(e) => setWhatsappNumber(e.target.value)}
                                            placeholder="Include country code without +"
                                            className="w-full px-3 py-2 border rounded shadow appearance-none text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                            required={!isLogin}
                                        />
                                    </div>
                                </>
                            )}

                            <div className="mb-4">
                                <label className="block mb-2 text-sm font-bold text-gray-700">Email</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full px-3 py-2 border rounded shadow appearance-none text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    required
                                />
                            </div>

                            <div className="mb-4">
                                <label className="block mb-2 text-sm font-bold text-gray-700">Password</label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full px-3 py-2 border rounded shadow appearance-none text-gray-700 leading-tight focus:outline-none focus:shadow-outline pr-10"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute inset-y-0 right-0 px-3 flex items-center text-sm leading-5 text-gray-600 hover:text-gray-800 focus:outline-none"
                                    >
                                        {showPassword ? "Hide" : "Show"}
                                    </button>
                                </div>
                                {isLogin && (
                                    <div className="text-right mt-1">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setShowForgot(true)
                                                setResetEmail(email) // Pre-fill if typed
                                                setError('')
                                            }}
                                            className="text-xs text-blue-500 hover:text-blue-700"
                                        >
                                            Forgot Password?
                                        </button>
                                    </div>
                                )}
                            </div>

                            {isLogin && (
                                <div className="mb-4 flex items-center">
                                    <input
                                        type="checkbox"
                                        id="rememberMe"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        className="mr-2 leading-tight"
                                    />
                                    <label className="text-sm text-gray-700 font-bold" htmlFor="rememberMe">
                                        Remember me (Enable offline login)
                                    </label>
                                </div>
                            )}

                            {!isLogin && (
                                <div className="mb-6">
                                    <label className="block mb-2 text-sm font-bold text-gray-700">Role</label>
                                    <select
                                        value={role}
                                        onChange={(e) => setRole(e.target.value)}
                                        className="w-full px-3 py-2 border rounded shadow appearance-none text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    >
                                        <option value="admin">Admin</option>
                                        <option value="marketing">Marketing</option>
                                        <option value="marketing_manager">Marketing Manager</option>
                                        <option value="pre_press">Prepress</option>
                                        <option value="po_officer">Purchase Officer</option>
                                        <option value="production">Production</option>
                                        <option value="qc">QC</option>
                                        <option value="delivery_officer">Delivery Officer</option>
                                    </select>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isLoading || !isOnline}
                                className={`w-full px-4 py-2 font-bold text-white rounded focus:outline-none focus:shadow-outline transition-colors ${isLoading || !isOnline
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-blue-500 hover:bg-blue-700'
                                    }`}
                            >
                                {isLoading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
                            </button>

                            <div className="mt-4 text-center">
                                <p className="text-sm text-gray-600">
                                    {isLogin ? "Don't have an account?" : "Already have an account?"}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setIsLogin(!isLogin)
                                            setError('')
                                            setShowForgot(false)
                                        }}
                                        className="ml-1 text-blue-500 hover:text-blue-700 font-bold focus:outline-none"
                                    >
                                        {isLogin ? "Sign Up" : "Login"}
                                    </button>
                                </p>
                            </div>
                        </form>
                    </>
                ) : (
                    <>
                        <h2 className="mb-4 text-xl font-bold text-center text-gray-800">
                            Reset Password
                        </h2>
                        <p className="mb-4 text-sm text-gray-600 text-center">
                            Enter your email validation to receive a password reset link.
                        </p>

                        {resetStatus.msg && (
                            <p className={`mb-4 text-sm p-2 rounded border ${resetStatus.type === 'success' ? 'text-green-600 bg-green-50 border-green-200' : 'text-red-500 bg-red-50 border-red-100'}`}>
                                {resetStatus.msg}
                            </p>
                        )}

                        <form onSubmit={handleResetPassword}>
                            <div className="mb-4">
                                <label className="block mb-2 text-sm font-bold text-gray-700">Email</label>
                                <input
                                    type="email"
                                    value={resetEmail}
                                    onChange={(e) => setResetEmail(e.target.value)}
                                    className="w-full px-3 py-2 border rounded shadow appearance-none text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    required
                                    placeholder="Enter your registered email"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading || !isOnline}
                                className={`w-full px-4 py-2 font-bold text-white rounded focus:outline-none focus:shadow-outline mb-3 transition-colors ${isLoading || !isOnline
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-blue-500 hover:bg-blue-700'
                                    }`}
                            >
                                {isLoading ? 'Sending...' : 'Send Reset Link'}
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setShowForgot(false)
                                    setResetStatus({ type: '', msg: '' })
                                }}
                                className="w-full px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 focus:outline-none"
                            >
                                Back to Login
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div >
    )
}