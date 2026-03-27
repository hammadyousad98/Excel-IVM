import { useState, useEffect } from 'react'

export interface Product {
    id: number
    category_id: number
    category_name: string
    description: string
    uom: string
    length: number
    width: number
    gsm: number
    min_stock_level: number
    current_stock: number
    last_rate: number
}

export const useInventory = () => {
    const [products, setProducts] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)

    const fetchProducts = async () => {
        try {
            const data = await window.electron.ipcRenderer.invoke('get-products')
            setProducts(data)
        } catch (error) {
            console.error('Failed to fetch products:', error)
        } finally {
            setLoading(false)
        }
    }

    const addProduct = async (product: Omit<Product, 'id' | 'category_name' | 'current_stock' | 'last_rate'>) => {
        try {
            await window.electron.ipcRenderer.invoke('create-product', product)
            fetchProducts()
            return true
        } catch (error) {
            console.error('Failed to create product:', error)
            return false
        }
    }

    useEffect(() => {
        fetchProducts()
    }, [])

    return { products, loading, fetchProducts, addProduct }
}
