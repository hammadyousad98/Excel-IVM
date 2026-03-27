import { useState, useEffect } from 'react'

export interface InventorySheet {
    id: number
    month: number
    year: number
    status: string
}

export const useSheets = (section: string = 'raw_material') => {
    const [sheets, setSheets] = useState<InventorySheet[]>([])
    const [loading, setLoading] = useState(true)

    const fetchSheets = async () => {
        try {
            const data = await window.electron.ipcRenderer.invoke('get-sheets', section)
            setSheets(data)
        } catch (error) {
            console.error('Failed to fetch sheets:', error)
        } finally {
            setLoading(false)
        }
    }

    const createSheet = async (month: number, year: number) => {
        try {
            await window.electron.ipcRenderer.invoke('create-sheet', { month, year, section })
            await fetchSheets()
            return true
        } catch (error) {
            console.error('Failed to create sheet:', error)
            return false
        }
    }

    useEffect(() => {
        fetchSheets()
    }, [section])

    return { sheets, loading, fetchSheets, createSheet }
}
