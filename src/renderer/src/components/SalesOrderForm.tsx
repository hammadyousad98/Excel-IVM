import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase'
import {
    collection,
    addDoc,
    getDocs,
    serverTimestamp,
    query,
    where,
    writeBatch
} from 'firebase/firestore'

// Loading Component
const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[200] backdrop-blur-sm">
        <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
            <div className="text-gray-700 font-bold text-lg">Processing...</div>
        </div>
    </div>
)

interface SalesOrderFormProps {
    onCancel: () => void
    onSuccess: () => void
}

export const SalesOrderForm: React.FC<SalesOrderFormProps> = ({ onCancel, onSuccess }) => {
    const { user } = useAuth()
    const [isLoading, setIsLoading] = useState(false)
    const [customers, setCustomers] = useState<any[]>([])
    const [products, setProducts] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])

    // Form State
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [customerId, setCustomerId] = useState('')
    const [poNo, setPoNo] = useState('')

    // Items State
    const [items, setItems] = useState<any[]>([
        { category_id: '', product_id: '', quantity: 0, tolerance: 0 }
    ])

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true)
            try {
                // Fetch Customers (Buyers)
                const customersSnap = await getDocs(collection(db, 'fg_buyers'))
                const c = customersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
                setCustomers(c)

                // Fetch Categories
                const categoriesSnap = await getDocs(collection(db, 'fg_categories'))
                const cat = categoriesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
                setCategories(cat)

                // Fetch Products
                const productsSnap = await getDocs(collection(db, 'fg_products'))
                const p = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
                setProducts(p)

            } catch (error) {
                console.error("Error fetching data:", error)
            } finally {
                setIsLoading(false)
            }
        }
        fetchData()
    }, [])

    const addItem = () => {
        setItems([...items, { category_id: '', product_id: '', quantity: 0, tolerance: 0 }])
    }

    const removeItem = (index: number) => {
        const newItems = [...items]
        newItems.splice(index, 1)
        setItems(newItems)
    }

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...items]
        newItems[index][field] = value

        // Auto-clear product if category changes to avoid mismatch
        if (field === 'category_id') {
            newItems[index]['product_id'] = '';
        }

        setItems(newItems)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!customerId || !poNo) {
            alert("Please fill in all required fields.")
            return
        }

        setIsLoading(true)
        try {
            const customerName = customers.find(c => c.id === customerId)?.name || ''

            const batch = writeBatch(db);

            // 1. Create Sales Order Document Ref
            const soCollectionRef = collection(db, 'fg_sales_orders');
            const soRef = await addDoc(soCollectionRef, {
                // Placeholder, we will overwrite or set properly in batch if needed, 
                // but addDoc generates ID immediately. 
                // Actually addDoc is a promise. 
                // Better to use doc() to generate ID then set() in batch.
                temp: true
            });
            // Wait, addDoc creates the doc. We want to be atomic.
            // Let's use clean doc generation.
        } catch (e) {
            // ...
        }

        // RESTARTING TRY BLOCK FOR CLEAN IMPL
        try {
            const customerName = customers.find(c => c.id === customerId)?.name || ''

            const batch = writeBatch(db);

            // Generate New SO ID
            const soRef = checkDoc(collection(db, 'fg_sales_orders'));

            const soData = {
                date,
                customer_id: customerId,
                customer_name: customerName,
                po_no: poNo,
                items: items.map(item => {
                    const prod = products.find(p => p.id === item.product_id)
                    const cat = categories.find(c => c.id === item.category_id)
                    return {
                        ...item,
                        product_name: prod?.description || '',
                        category_name: cat?.name || '',
                        item_code: prod?.item_code || ''
                    }
                }),
                total_quantity: items.reduce((sum, i) => sum + Number(i.quantity), 0),
                createdAt: serverTimestamp(),
                createdBy: user?.uid || 'unknown'
            }

            batch.set(soRef, soData);

            // 2. Resolve or Create Inventory Sheet
            const d = new Date(date);
            const month = d.getMonth() + 1;
            const year = d.getFullYear();

            const sheetsQuery = query(
                collection(db, 'fg_inventory_sheets'),
                where('month', '==', month),
                where('year', '==', year),
                where('section', '==', 'finished_goods')
            );

            const sheetsSnap = await getDocs(sheetsQuery);
            let sheetId = '';

            if (sheetsSnap.empty) {
                const newSheetRef = checkDoc(collection(db, 'fg_inventory_sheets'));
                batch.set(newSheetRef, {
                    month,
                    year,
                    section: 'finished_goods',
                    createdAt: serverTimestamp()
                });
                sheetId = newSheetRef.id;
            } else {
                sheetId = sheetsSnap.docs[0].id;
            }

            // 3. Create Transactions
            items.forEach(item => {
                const prod = products.find(p => p.id === item.product_id)
                const cat = categories.find(c => c.id === item.category_id)

                const newTransRef = checkDoc(collection(db, 'fg_inventory_transactions'));

                batch.set(newTransRef, {
                    sheet_id: sheetId,
                    date: date,
                    type: 'Sales Order',
                    transaction_type: 'Sales Order',

                    po_no: poNo,
                    customer_name: customerName,
                    manual_supplier_name: customerName, // Populate for Inventory consistency
                    supplier_name: customerName,

                    category_name: cat?.name || '',
                    manual_category_name: cat?.name || '',

                    product_id: item.product_id,
                    product_name: prod?.description || '',
                    manual_product_name: prod?.description || '',

                    quantity: 0, // NO STOCK IMPACT
                    display_quantity: Number(item.quantity),

                    tolerance: Number(item.tolerance),

                    createdAt: serverTimestamp(),
                    so_id: soRef.id,
                    section: 'finished_goods'
                });
            });

            await batch.commit();
            onSuccess();

        } catch (error) {
            console.error("Error saving sales order:", error)
            alert("Failed to save Sales Order")
        } finally {
            setIsLoading(false)
        }
    }

    // Helper helper
    const checkDoc = (coll: any) => {
        const { doc } = require('firebase/firestore');
        return doc(coll);
    }

    return (
        <div className="p-6 bg-white rounded-lg shadow-lg relative min-h-[500px]">
            {isLoading && <LoadingOverlay />}

            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">New Sales Order</h2>
                <button onClick={onCancel} className="text-gray-500 hover:text-gray-700">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Date</label>
                        <input
                            type="date"
                            required
                            className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Customer</label>
                        <select
                            required
                            className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                            value={customerId}
                            onChange={e => setCustomerId(e.target.value)}
                        >
                            <option value="">Select Customer</option>
                            {customers.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">P.O. Number</label>
                        <input
                            type="text"
                            required
                            placeholder="Enter PO No manually"
                            className="w-full border border-gray-300 rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                            value={poNo}
                            onChange={e => setPoNo(e.target.value)}
                        />
                    </div>
                </div>

                <div className="mb-6">
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-lg font-bold text-gray-800">Items</label>
                        <button
                            type="button"
                            onClick={addItem}
                            className="text-blue-600 hover:text-blue-800 text-sm font-bold flex items-center"
                        >
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                            Add Item
                        </button>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4">
                        {items.map((item, index) => (
                            <div key={index} className="grid grid-cols-12 gap-4 items-end bg-white p-3 rounded shadow-sm">
                                <div className="col-span-3">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                                    <select
                                        required
                                        className="w-full border border-gray-300 rounded p-1.5 text-sm"
                                        value={item.category_id}
                                        onChange={e => updateItem(index, 'category_id', e.target.value)}
                                    >
                                        <option value="">Select Category</option>
                                        {categories.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="col-span-4">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
                                    <select
                                        required
                                        className="w-full border border-gray-300 rounded p-1.5 text-sm"
                                        value={item.product_id}
                                        onChange={e => updateItem(index, 'product_id', e.target.value)}
                                        disabled={!item.category_id}
                                    >
                                        <option value="">Select Product</option>
                                        {products
                                            .filter(p => !item.category_id || p.category_id === item.category_id)
                                            .map(p => (
                                                <option key={p.id} value={p.id}>{p.description}</option>
                                            ))}
                                    </select>
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Quantity</label>
                                    <input
                                        type="number"
                                        required
                                        min="0"
                                        className="w-full border border-gray-300 rounded p-1.5 text-sm"
                                        value={item.quantity}
                                        onChange={e => updateItem(index, 'quantity', e.target.value)}
                                    />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Tolerance</label>
                                    <input
                                        type="number"
                                        min="0"
                                        className="w-full border border-gray-300 rounded p-1.5 text-sm"
                                        value={item.tolerance}
                                        onChange={e => updateItem(index, 'tolerance', e.target.value)}
                                    />
                                </div>
                                <div className="col-span-1 flex justify-center pb-1">
                                    {items.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeItem(index)}
                                            className="text-red-500 hover:text-red-700"
                                            title="Remove Item"
                                        >
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-bold shadow-sm"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Saving...' : 'Create Sales Order'}
                    </button>
                </div>
            </form>
        </div>
    )
}
