import React, { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, doc, writeBatch, serverTimestamp, getDocs, query, where, addDoc } from 'firebase/firestore'
import { SearchableDropdown } from './SearchableDropdown'

interface BulkSalesOrderModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
}

export const BulkSalesOrderModal: React.FC<BulkSalesOrderModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const [rows, setRows] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    // Data
    const [customers, setCustomers] = useState<any[]>([])
    const [products, setProducts] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])

    // Initialize
    useEffect(() => {
        if (isOpen) {
            fetchData()
            if (rows.length === 0) addRow()
        }
    }, [isOpen])

    const fetchData = async () => {
        try {
            const [cSnap, pSnap, catSnap] = await Promise.all([
                getDocs(collection(db, 'fg_buyers')),
                getDocs(collection(db, 'fg_products')),
                getDocs(collection(db, 'fg_categories'))
            ])
            setCustomers(cSnap.docs.map(d => ({ id: d.id, ...d.data() })))
            setProducts(pSnap.docs.map(d => ({ id: d.id, ...d.data() })))
            setCategories(catSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        } catch (e) {
            console.error(e)
        }
    }

    const addRow = () => {
        setRows([...rows, {
            id: Date.now(),
            date: new Date().toISOString().split('T')[0],
            customer_id: '',
            po_no: '',
            category_id: '',
            product_id: '',
            quantity: 0,
            tolerance: 0
        }])
    }

    const removeRow = (index: number) => {
        const newRows = [...rows]
        newRows.splice(index, 1)
        setRows(newRows)
    }

    const updateRow = (index: number, field: string, value: any) => {
        const newRows = [...rows]
        newRows[index][field] = value

        // Auto-set Category if Product Selected
        if (field === 'product_id') {
            const p = products.find(prod => prod.id === value)
            if (p && p.category_id) {
                newRows[index].category_id = p.category_id
            }
        }

        setRows(newRows)
    }

    const handleSave = async () => {
        setError('')

        // Validation
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i]
            if (!r.customer_id || !r.po_no || !r.product_id || !r.quantity) {
                setError(`Row ${i + 1}: Missing required fields.`)
                return
            }
        }

        setIsLoading(true)
        try {
            const batch = writeBatch(db)

            // Group by PO + Customer to create unified Sales Orders
            const groupedPOs: { [key: string]: any } = {}

            rows.forEach(row => {
                const key = `${row.customer_id}_${row.po_no}`
                if (!groupedPOs[key]) {
                    groupedPOs[key] = {
                        date: row.date,
                        customer_id: row.customer_id,
                        po_no: row.po_no,
                        items: []
                    }
                }
                groupedPOs[key].items.push(row)
            })

            // Process each Group
            for (const key in groupedPOs) {
                const group = groupedPOs[key]
                const customer = customers.find(c => c.id === group.customer_id)

                // 1. Create SO
                const soRef = doc(collection(db, 'fg_sales_orders'))

                const soItems = group.items.map((item: any) => {
                    const prod = products.find(p => p.id === item.product_id)
                    const cat = categories.find(c => c.id === item.category_id)
                    return {
                        category_id: item.category_id,
                        product_id: item.product_id,
                        quantity: Number(item.quantity),
                        tolerance: Number(item.tolerance),
                        product_name: prod?.description || '',
                        category_name: cat?.name || '',
                        item_code: prod?.item_code || '',
                        uom: prod?.uom || ''
                    }
                })

                batch.set(soRef, {
                    date: group.date, // Use first date? Or ensure they match? Assuming same.
                    customer_id: group.customer_id,
                    customer_name: customer?.name || 'Unknown',
                    po_no: group.po_no,
                    items: soItems,
                    total_quantity: soItems.reduce((sum: number, i: any) => sum + i.quantity, 0),
                    createdAt: serverTimestamp()
                })

                // 2. Sheet Check (Month/Year)
                const d = new Date(group.date)
                const month = d.getMonth() + 1
                const year = d.getFullYear()

                // We need to query sheet. 
                // Since this is inside a loop, we should probably cache sheets? 
                // For simplicity, we query individually (batch limit is 500 ops).
                const qSheet = query(collection(db, 'fg_inventory_sheets'),
                    where('month', '==', month), where('year', '==', year), where('section', '==', 'finished_goods'))

                const sheetSnap = await getDocs(qSheet)
                let sheetId = ''

                if (sheetSnap.empty) {
                    const newSheetRef = doc(collection(db, 'fg_inventory_sheets'))
                    batch.set(newSheetRef, {
                        month, year, section: 'finished_goods', createdAt: serverTimestamp()
                    })
                    sheetId = newSheetRef.id
                } else {
                    sheetId = sheetSnap.docs[0].id
                }

                // 3. Transactions 
                soItems.forEach((item: any) => {
                    const transRef = doc(collection(db, 'fg_inventory_transactions'))
                    batch.set(transRef, {
                        sheet_id: sheetId,
                        date: group.date,
                        type: 'Sales Order',
                        transaction_type: 'Sales Order',
                        po_no: group.po_no,
                        customer_name: customer?.name || '',
                        manual_supplier_name: customer?.name || '',
                        product_id: item.product_id,
                        item_code: item.item_code || '',
                        product_name: item.product_name,
                        manual_product_name: item.product_name,
                        uom: item.uom || '',
                        category_name: item.category_name,
                        manual_category_name: item.category_name,
                        quantity: 0,
                        display_quantity: item.quantity,
                        tolerance: item.tolerance,
                        so_id: soRef.id,
                        section: 'finished_goods',
                        createdAt: serverTimestamp()
                    })
                })
            }

            await batch.commit()
            onSuccess()
            onClose()
            setRows([])
            addRow()

        } catch (e: any) {
            console.error(e)
            setError(e.message)
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[110] backdrop-blur-sm">
            <div className="bg-white w-full max-w-[95vw] h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <h2 className="text-xl font-bold text-gray-800">Bulk Add Sales Orders</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
                </div>

                <div className="flex-1 overflow-auto p-4 bg-gray-100">
                    {error && <div className="p-3 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

                    <div className="bg-white shadow rounded-lg overflow-hidden">
                        <table className="w-full min-w-[1100px]">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="p-3 text-left">Date</th>
                                    <th className="p-3 text-left">Customer</th>
                                    <th className="p-3 text-left">PO No.</th>
                                    <th className="p-3 text-left">Product</th>
                                    <th className="p-3 text-left">Item Code</th>
                                    <th className="p-3 text-left">Qty</th>
                                    <th className="p-3 text-left">Tolerance</th>
                                    <th className="p-3 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, index) => (
                                    <tr key={row.id} className="border-b hover:bg-gray-50">
                                        <td className="p-2 w-32">
                                            <input type="date" value={row.date} onChange={e => updateRow(index, 'date', e.target.value)} className="w-full border rounded p-1" />
                                        </td>
                                        <td className="p-2 w-48">
                                            <SearchableDropdown
                                                options={customers.map(c => ({ id: c.id, label: c.name }))}
                                                value={row.customer_id}
                                                onChange={val => updateRow(index, 'customer_id', val)}
                                                placeholder="Customer"
                                            />
                                        </td>
                                        <td className="p-2 w-32">
                                            <input type="text" value={row.po_no} onChange={e => updateRow(index, 'po_no', e.target.value)} className="w-full border rounded p-1" placeholder="PO No" />
                                        </td>
                                        <td className="p-2 w-48">
                                            <SearchableDropdown
                                                options={products
                                                    .filter(p => !row.customer_id || p.customer_id === row.customer_id)
                                                    .map(p => ({ id: p.id, label: p.description }))}
                                                value={row.product_id}
                                                onChange={val => updateRow(index, 'product_id', val)}
                                                placeholder={row.customer_id ? "Product" : "Sel Cust."}
                                            />
                                        </td>
                                        <td className="p-2 w-28">
                                            <input
                                                type="text"
                                                readOnly
                                                className="w-full border bg-gray-100 border-gray-300 rounded p-1 text-sm font-medium text-gray-700"
                                                value={products.find(p => p.id === row.product_id)?.item_code || ''}
                                            />
                                        </td>
                                        <td className="p-2 w-24">
                                            <input type="number" value={row.quantity} onChange={e => updateRow(index, 'quantity', e.target.value)} className="w-full border rounded p-1" />
                                        </td>
                                        <td className="p-2 w-24">
                                            <input type="number" value={row.tolerance} onChange={e => updateRow(index, 'tolerance', e.target.value)} className="w-full border rounded p-1" />
                                        </td>
                                        <td className="p-2 text-center">
                                            <button onClick={() => removeRow(index)} className="text-red-500 hover:text-red-700">&times;</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="p-4 border-t bg-gray-50 flex justify-between">
                    <button onClick={addRow} className="text-blue-600 font-bold">+ Add Row</button>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
                        <button onClick={handleSave} disabled={isLoading} className="px-6 py-2 bg-green-600 text-white rounded shadow font-bold">
                            {isLoading ? 'Saving...' : 'Save All'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
