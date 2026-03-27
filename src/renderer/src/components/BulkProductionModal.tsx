import React, { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, doc, writeBatch, serverTimestamp, getDocs, query, where, increment, orderBy } from 'firebase/firestore'
import { SearchableDropdown } from './SearchableDropdown'

interface BulkProductionModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
}

export const BulkProductionModal: React.FC<BulkProductionModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const [rows, setRows] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')

    // Data
    const [salesOrders, setSalesOrders] = useState<any[]>([])
    const [products, setProducts] = useState<any[]>([])

    // Initialize
    useEffect(() => {
        if (isOpen) {
            setRows([]); // Reset rows
            const initialRow = {
                id: Date.now(),
                date: new Date().toISOString().split('T')[0],
                po_no: '',
                product_id: '',
                box_qty: 0,
                qty_per_box: 0,
                total_qty: 0,
                has_short_item: false,
                short_box_qty: 0,
                short_qty_per_box: 0,
                short_total_qty: 0
            };
            setRows([initialRow]);
            fetchData()
        }
    }, [isOpen])

    const fetchData = async () => {
        try {
            // Fetch POs
            const q = query(collection(db, 'fg_sales_orders'), orderBy('createdAt', 'desc'))
            const soSnap = await getDocs(q)
            setSalesOrders(soSnap.docs.map(d => ({ id: d.id, ...d.data() })))

            // Fetch Products
            const pSnap = await getDocs(collection(db, 'fg_products'))
            setProducts(pSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        } catch (e) {
            console.error(e)
        }
    }

    const addRow = () => {
        setRows(prev => [...prev, {
            id: Date.now() + Math.random(),
            date: new Date().toISOString().split('T')[0],
            po_no: '',
            product_id: '',
            box_qty: 0,
            qty_per_box: 0,
            total_qty: 0,
            has_short_item: false,
            short_box_qty: 0,
            short_qty_per_box: 0,
            short_total_qty: 0
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

        // Auto Calc
        if (field === 'box_qty' || field === 'qty_per_box') {
            const b = Number(newRows[index].box_qty)
            const q = Number(newRows[index].qty_per_box)
            newRows[index].total_qty = b * q
        }

        // Auto Calc Short
        if (field === 'short_box_qty' || field === 'short_qty_per_box') {
            const sb = Number(newRows[index].short_box_qty || 0)
            const sq = Number(newRows[index].short_qty_per_box || 0)
            newRows[index].short_total_qty = sb * sq
        }

        setRows(newRows)
    }

    const handleSave = async () => {
        setError('')

        for (let i = 0; i < rows.length; i++) {
            const r = rows[i]
            if (!r.po_no || !r.product_id || !r.total_qty) {
                setError(`Row ${i + 1}: Missing required fields or 0 qty.`)
                return
            }
        }

        setIsLoading(true)
        try {
            const batch = writeBatch(db)

            // Cache sheets to minimize reads
            const sheetCache: { [key: string]: string } = {}

            for (const row of rows) {
                const so = salesOrders.find(s => s.po_no === row.po_no)
                const prod = products.find(p => p.id === row.product_id)
                const customerName = so?.customer_name || 'Unknown'

                // Sheet Logic
                const d = new Date(row.date)
                const month = d.getMonth() + 1
                const year = d.getFullYear()
                const sheetKey = `${month}-${year}`

                let sheetId = sheetCache[sheetKey]

                if (!sheetId) {
                    const qSheet = query(collection(db, 'fg_inventory_sheets'),
                        where('month', '==', month), where('year', '==', year), where('section', '==', 'finished_goods'))
                    const snap = await getDocs(qSheet)

                    if (snap.empty) {
                        const newSheetRef = doc(collection(db, 'fg_inventory_sheets'))
                        batch.set(newSheetRef, {
                            month, year, section: 'finished_goods', createdAt: serverTimestamp()
                        })
                        sheetId = newSheetRef.id
                    } else {
                        sheetId = snap.docs[0].id
                    }
                    sheetCache[sheetKey] = sheetId
                }

                // Transaction
                const transRef = doc(collection(db, 'fg_inventory_transactions'))
                batch.set(transRef, {
                    sheet_id: sheetId,
                    job_card_id: so?.job_card_id || null, // Link to Job Card
                    date: row.date,
                    type: 'Manufactured Product',
                    transaction_type: 'Manufactured Product',
                    po_no: row.po_no,
                    po_id: so?.id || null,
                    customer_name: customerName,
                    manual_supplier_name: customerName,
                    product_id: row.product_id,
                    item_code: prod?.item_code || '',
                    product_name: prod?.description || '',
                    manual_product_name: prod?.description || '',
                    uom: prod?.uom || '',
                    category_name: prod?.category_name || '',
                    manual_category_name: prod?.category_name || '',
                    quantity: Number(row.total_qty),
                    display_quantity: Number(row.total_qty),
                    box_qty: Number(row.box_qty),
                    qty_per_box: Number(row.qty_per_box),
                    section: 'finished_goods',
                    createdAt: serverTimestamp()
                })

                // Stock Update
                const prodRef = doc(db, 'fg_products', row.product_id)
                batch.update(prodRef, {
                    current_stock: increment(Number(row.total_qty)),
                    updatedAt: serverTimestamp()
                })

                // Short Item Transaction
                if (row.has_short_item && row.short_total_qty > 0) {
                    const shortTransRef = doc(collection(db, 'fg_inventory_transactions'))
                    batch.set(shortTransRef, {
                        sheet_id: sheetId,
                        job_card_id: so?.job_card_id || null, // Link to Job Card
                        date: row.date,
                        type: 'Manufactured Product',
                        transaction_type: 'Manufactured Product',
                        po_no: row.po_no,
                        po_id: so?.id || null,
                        customer_name: customerName,
                        manual_supplier_name: customerName,
                        product_id: row.product_id,
                        item_code: prod?.item_code || '',
                        product_name: prod?.description || '',
                        manual_product_name: prod?.description || '',
                        uom: prod?.uom || '',
                        category_name: prod?.category_name || '',
                        manual_category_name: prod?.category_name || '',
                        quantity: Number(row.short_total_qty),
                        display_quantity: Number(row.short_total_qty),
                        box_qty: Number(row.short_box_qty),
                        qty_per_box: Number(row.short_qty_per_box),
                        is_short_item_entry: true,
                        section: 'finished_goods',
                        createdAt: serverTimestamp()
                    })

                    // Stock Update (Short)
                    batch.update(prodRef, {
                        current_stock: increment(Number(row.short_total_qty)),
                        updatedAt: serverTimestamp()
                    })
                }
            }

            await batch.commit()
            onSuccess()
            onClose()
            // setRows([]) // useEffect on isOpen handles reset now
            // addRow() // useEffect on isOpen handles reset now

        } catch (e: any) {
            console.error(e)
            setError(e.message)
        } finally {
            setIsLoading(false)
        }
    }

    // Unique POs
    const uniquePOs = Array.from(new Set(salesOrders.map(s => s.po_no)))

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[110] backdrop-blur-sm">
            <div className="bg-white w-full max-w-[95vw] h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <h2 className="text-xl font-bold text-gray-800">Bulk Add Production</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">&times;</button>
                </div>

                <div className="flex-1 overflow-auto p-4 bg-gray-100">
                    {error && <div className="p-3 bg-red-100 text-red-700 rounded mb-4">{error}</div>}

                    <div className="bg-white shadow rounded-lg overflow-hidden">
                        <table className="w-full min-w-[1100px]">
                            <thead className="bg-gray-50 border-b">
                                <tr>
                                    <th className="p-3 text-left">Date</th>
                                    <th className="p-3 text-left">PO No.</th>
                                    <th className="p-3 text-left">Customer</th>
                                    <th className="p-3 text-left">Product</th>
                                    <th className="p-3 text-left">Item Code</th>
                                    <th className="p-3 text-left">Box Qty</th>
                                    <th className="p-3 text-left">Qty/Box</th>
                                    <th className="p-3 text-left">Total Qty</th>
                                    <th className="p-3 text-center bg-orange-50">Short?</th>
                                    <th className="p-3 text-left bg-orange-50">Short Box</th>
                                    <th className="p-3 text-left bg-orange-50">Short Q/B</th>
                                    <th className="p-3 text-left bg-orange-50">Short Total</th>
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
                                                options={uniquePOs.map(po => ({ id: po, label: po }))}
                                                value={row.po_no}
                                                onChange={(val) => {
                                                    updateRow(index, 'po_no', String(val));
                                                    updateRow(index, 'product_id', '');
                                                }}
                                                placeholder="Select PO"
                                            />
                                        </td>
                                        <td className="p-2 w-40">
                                            <input
                                                type="text"
                                                readOnly
                                                className="w-full border bg-gray-100 border-gray-300 rounded p-1.5 text-sm text-gray-600 font-medium truncate"
                                                value={row.po_no ? (salesOrders.find(s => s.po_no === row.po_no)?.customer_name || 'Unknown') : 'Select PO'}
                                                title={row.po_no ? (salesOrders.find(s => s.po_no === row.po_no)?.customer_name || 'Unknown Customer') : ''}
                                            />
                                        </td>
                                        <td className="p-2 w-48">
                                            {(() => {
                                                const selectedSO = salesOrders.find(so => so.po_no === row.po_no);
                                                const allowedProductIds = selectedSO?.items?.map((i: any) => i.product_id) || [];
                                                const filteredProducts = products.filter(p => allowedProductIds.includes(p.id));

                                                return (
                                                    <SearchableDropdown
                                                        options={filteredProducts.map(p => ({ id: p.id, label: p.description }))}
                                                        value={row.product_id}
                                                        onChange={val => updateRow(index, 'product_id', val)}
                                                        placeholder={row.po_no ? "Select Product" : "Select PO First"}
                                                        disabled={!row.po_no}
                                                    />
                                                );
                                            })()}
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
                                            <input type="number" value={row.box_qty} onChange={e => updateRow(index, 'box_qty', e.target.value)} className="w-full border rounded p-1" />
                                        </td>
                                        <td className="p-2 w-24">
                                            <input type="number" value={row.qty_per_box} onChange={e => updateRow(index, 'qty_per_box', e.target.value)} className="w-full border rounded p-1" />
                                        </td>
                                        <td className="p-2 w-24">
                                            <input type="number" value={row.total_qty || 0} readOnly className="w-full border bg-gray-100 rounded p-1 font-bold" />
                                        </td>

                                        {/* Short Item Columns */}
                                        <td className="p-2 w-16 text-center bg-orange-50">
                                            <input
                                                type="checkbox"
                                                checked={row.has_short_item || false}
                                                onChange={e => updateRow(index, 'has_short_item', e.target.checked)}
                                                className="w-4 h-4 cursor-pointer"
                                            />
                                        </td>
                                        <td className="p-2 w-24 bg-orange-50">
                                            {row.has_short_item && (
                                                <input type="number" value={row.short_box_qty || 0} onChange={e => updateRow(index, 'short_box_qty', e.target.value)} className="w-full border border-orange-300 rounded p-1" />
                                            )}
                                        </td>
                                        <td className="p-2 w-24 bg-orange-50">
                                            {row.has_short_item && (
                                                <input type="number" value={row.short_qty_per_box || 0} onChange={e => updateRow(index, 'short_qty_per_box', e.target.value)} className="w-full border border-orange-300 rounded p-1" />
                                            )}
                                        </td>
                                        <td className="p-2 w-24 bg-orange-50">
                                            {row.has_short_item && (
                                                <input type="number" value={row.short_total_qty || 0} readOnly className="w-full border border-orange-200 bg-orange-100 rounded p-1 font-bold text-gray-700" />
                                            )}
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
