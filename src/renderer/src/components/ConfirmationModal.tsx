// src/renderer/src/components/ConfirmationModal.tsx
import React, { useEffect } from 'react'

interface ConfirmationModalProps {
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => void
    onCancel: () => void
    confirmText?: string
    cancelText?: string
    isDangerous?: boolean
    hideCancel?: boolean
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    title,
    message,
    onConfirm,
    onCancel,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    isDangerous = false,
    hideCancel = false
}) => {
    // THE FIX: Handle Escape key to close modal
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        if (isOpen) window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [isOpen, onCancel]);

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-6 animate-in fade-in zoom-in duration-200">
                <h3 className={`text-xl font-bold mb-3 ${isDangerous ? 'text-red-600' : 'text-gray-800'}`}>
                    {title}
                </h3>
                <p className="text-gray-600 mb-8 leading-relaxed break-words overflow-hidden">
                    {message}
                </p>
                <div className="flex justify-end gap-3">
                    {!hideCancel && (
                        <button
                            onClick={onCancel}
                            className="px-5 py-2.5 text-gray-500 hover:bg-gray-100 rounded-lg font-bold transition-colors"
                        >
                            {cancelText}
                        </button>
                    )}
                    <button
                        onClick={onConfirm}
                        className={`px-5 py-2.5 text-white rounded-lg font-bold shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0 ${isDangerous
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    )
}