import React, { useEffect, useState } from 'react'

interface UpdateInfo {
    version: string;
    files: any[];
    path: string;
    sha512: string;
    releaseDate: string;
}

export const UpdateNotification: React.FC = () => {
    const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null)
    const [downloading, setDownloading] = useState(false)
    const [updateReady, setUpdateReady] = useState(false)
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        // @ts-ignore
        const handleUpdateAvailable = (_event, info) => {
            console.log('Update available:', info)
            setUpdateAvailable(info)
        }

        // @ts-ignore
        const handleDownloadProgress = (_event, progressObj) => {
            console.log('Download progress:', progressObj)
            setDownloading(true)
            setProgress(progressObj.percent)
        }

        // @ts-ignore
        const handleUpdateDownloaded = (_event, info) => {
            console.log('Update downloaded:', info)
            setDownloading(false)
            setUpdateReady(true)
        }

        // @ts-ignore
        const handleUpdateError = (_event, err) => {
            console.error('Update error:', err)
            setError(typeof err === 'string' ? err : 'Unknown error')
            setDownloading(false)
        }

        // @ts-ignore
        window.electron.ipcRenderer.on('update-available', handleUpdateAvailable)
        // @ts-ignore
        window.electron.ipcRenderer.on('download-progress', handleDownloadProgress)
        // @ts-ignore
        window.electron.ipcRenderer.on('update-downloaded', handleUpdateDownloaded)
        // @ts-ignore
        window.electron.ipcRenderer.on('update-error', handleUpdateError)

        // Check for updates shortly after mount
        setTimeout(() => {
            // @ts-ignore
            window.electron.ipcRenderer.invoke('check-for-updates')
        }, 3000)

        return () => {
            // @ts-ignore
            window.electron.ipcRenderer.removeListener('update-available', handleUpdateAvailable)
            // @ts-ignore
            window.electron.ipcRenderer.removeListener('download-progress', handleDownloadProgress)
            // @ts-ignore
            window.electron.ipcRenderer.removeListener('update-downloaded', handleUpdateDownloaded)
            // @ts-ignore
            window.electron.ipcRenderer.removeListener('update-error', handleUpdateError)
        }
    }, [])

    const startDownload = () => {
        setDownloading(true)
        // @ts-ignore
        window.electron.ipcRenderer.invoke('start-download')
    }

    const installUpdate = () => {
        // @ts-ignore
        window.electron.ipcRenderer.invoke('quit-and-install')
    }

    const dismiss = () => {
        setUpdateAvailable(null)
        setUpdateReady(false)
        setError(null)
    }

    if (!updateAvailable && !error) return null

    return (
        <div className="fixed bottom-4 right-4 z-50 w-96 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden animate-fade-in-up">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 flex justify-between items-center">
                <h3 className="text-white font-semibold">
                    {error ? 'Update Error' : updateReady ? 'Update Ready' : 'Update Available'}
                </h3>
                <button onClick={dismiss} className="text-blue-100 hover:text-white">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div className="p-4">
                {error ? (
                    <div className="text-red-600 text-sm">{error}</div>
                ) : updateReady ? (
                    <div>
                        <p className="text-gray-600 mb-4 text-sm">
                            Version {updateAvailable?.version} has been downloaded and is ready to install.
                        </p>
                        <button
                            onClick={installUpdate}
                            className="w-full py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded font-medium transition-colors"
                        >
                            Restart & Update
                        </button>
                    </div>
                ) : downloading ? (
                    <div>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>Downloading...</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                            <div
                                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                    </div>
                ) : (
                    <div>
                        <p className="text-gray-600 mb-4 text-sm">
                            A new version ({updateAvailable?.version}) is available.
                        </p>
                        <div className="flex space-x-3">
                            <button
                                onClick={startDownload}
                                className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors text-sm"
                            >
                                Download
                            </button>
                            <button
                                onClick={dismiss}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors text-sm"
                            >
                                Later
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
