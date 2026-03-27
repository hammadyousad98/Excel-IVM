/// <reference types="vite/client" />

interface Window {
    electron: {
        ipcRenderer: {
            send(channel: string, ...args: any[]): void
            on(channel: string, func: (event: any, ...args: any[]) => void): () => void
            once(channel: string, func: (event: any, ...args: any[]) => void): () => void
            removeAllListeners(channel: string): void
            invoke(channel: string, ...args: any[]): Promise<any>
        }
    }
}
