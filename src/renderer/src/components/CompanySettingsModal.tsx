import React, { useState, useEffect } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ConfirmationModal } from './ConfirmationModal'
import { useAuth } from '../context/AuthContext'

interface CompanySettings {
    name: string
    address: string
    telephone: string
    fax: string
    ntn: string
    logo_path: string
}

interface Props {
    isOpen: boolean
    onClose: () => void
}

// Loading Component
const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[200] backdrop-blur-sm">
        <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3">
            </div>
            <div className="text-gray-700 font-bold text-lg">Saving...</div>
        </div>
    </div>
)

export const CompanySettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const [settings, setSettings] = useState<CompanySettings>({
        name: '',
        address: '',
        telephone: '',
        fax: '',
        ntn: '',
        logo_path: ''
    })
    const [isLoading, setIsLoading] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)
    const { user } = useAuth()
    const isAdmin = user?.role === 'admin'

    useEffect(() => {
        if (isOpen) {
            fetchSettings()
        }
    }, [isOpen])

    const fetchSettings = async () => {
        try {
            const docRef = doc(db, 'settings', 'company_profile');
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                setSettings(docSnap.data() as CompanySettings);
            }
        } catch (error) {
            console.error('Failed to fetch company settings', error)
        }
    }

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            if (file.type !== 'image/png') {
                alert('Only PNG images are allowed for the logo.')
                return
            }

            const reader = new FileReader()
            reader.onloadend = () => {
                setSettings(prev => ({ ...prev, logo_path: reader.result as string }))
            }
            reader.readAsDataURL(file)
        }
    }

    const handleSaveClick = (e: React.FormEvent) => {
        e.preventDefault()
        setShowConfirm(true) // Trigger confirmation modal instead of saving directly
    }

    const executeSave = async () => {
        setIsLoading(true)
        try {
            // Save to 'settings' collection, document 'company_profile'
            await setDoc(doc(db, 'settings', 'company_profile'), settings);
            onClose()
        } catch (error) {
            console.error('Failed to save settings', error)
            alert('Failed to save settings.')
        } finally {
            setIsLoading(false)
            setShowConfirm(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            {isLoading && <LoadingOverlay />}

            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
                <div className="flex justify-between items-center p-6 border-b">
                    <h2 className="text-xl font-bold text-gray-800">Company Settings</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSaveClick} className="p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                            <input
                                type="text"
                                required
                                value={settings.name}
                                onChange={e => setSettings({ ...settings, name: e.target.value })}
                                readOnly={!isAdmin}
                                className={`w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${!isAdmin ? 'bg-gray-100 text-gray-500' : ''}`}
                            />
                        </div>

                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                            <textarea
                                rows={3}
                                value={settings.address}
                                onChange={e => setSettings({ ...settings, address: e.target.value })}
                                readOnly={!isAdmin}
                                className={`w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${!isAdmin ? 'bg-gray-100 text-gray-500' : ''}`}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Telephone</label>
                            <input
                                type="text"
                                value={settings.telephone}
                                onChange={e => setSettings({ ...settings, telephone: e.target.value })}
                                readOnly={!isAdmin}
                                className={`w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${!isAdmin ? 'bg-gray-100 text-gray-500' : ''}`}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Fax</label>
                            <input
                                type="text"
                                value={settings.fax}
                                onChange={e => setSettings({ ...settings, fax: e.target.value })}
                                readOnly={!isAdmin}
                                className={`w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${!isAdmin ? 'bg-gray-100 text-gray-500' : ''}`}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">NTN Number</label>
                            <input
                                type="text"
                                value={settings.ntn}
                                onChange={e => setSettings({ ...settings, ntn: e.target.value })}
                                readOnly={!isAdmin}
                                className={`w-full border rounded-md p-2 focus:ring-blue-500 focus:border-blue-500 ${!isAdmin ? 'bg-gray-100 text-gray-500' : ''}`}
                            />
                        </div>

                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Company Logo (PNG Only)</label>
                            <div className="flex items-center space-x-4">
                                {settings.logo_path && (
                                    <img
                                        src={settings.logo_path}
                                        alt="Logo Preview"
                                        className="h-16 w-auto border rounded p-1"
                                    />
                                )}
                                {isAdmin && (
                                    <input
                                        type="file"
                                        accept="image/png"
                                        onChange={handleLogoChange}
                                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="mr-3 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                        >

                            {isAdmin ? 'Cancel' : 'Close'}
                        </button>
                        {isAdmin && (
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                            >
                                Save Settings
                            </button>
                        )}
                    </div>
                </form>

                <ConfirmationModal
                    isOpen={showConfirm}
                    title="Save Changes"
                    message="Are you sure you want to update the company settings? This will affect all generated documents."
                    onConfirm={executeSave}
                    onCancel={() => setShowConfirm(false)}
                    confirmText="Save"
                />
            </div>
        </div>
    )
}   