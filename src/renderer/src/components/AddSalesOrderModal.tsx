import React, { useState, useEffect } from 'react'
import { SearchableDropdown } from './SearchableDropdown'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase'
import {
    collection,
    addDoc,
    getDocs,
    serverTimestamp,
    query,
    where,
    writeBatch,
    doc,
    updateDoc,
    deleteDoc
} from 'firebase/firestore'

// Loading Component
const LoadingOverlay = () => (
    <div className="absolute inset-0 bg-white bg-opacity-70 flex items-center justify-center z-[50] backdrop-blur-sm rounded-lg">
        <div className="flex flex-col items-center">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-2"></div>
            <div className="text-gray-700 font-bold text-sm">Processing...</div>
        </div>
    </div>
)

interface AddSalesOrderModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    initialData?: any // For editing
}

export const AddSalesOrderModal: React.FC<AddSalesOrderModalProps> = ({ isOpen, onClose, onSuccess, initialData }) => {
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
        if (isOpen) {
            fetchData()
            if (initialData) {
                // Populate form for editing
                setDate(initialData.date)
                setCustomerId(initialData.customer_id)
                setPoNo(initialData.po_no)
                if (initialData.items && Array.isArray(initialData.items)) {
                    setItems(initialData.items.map((i: any) => ({
                        category_id: i.category_id,
                        product_id: i.product_id,
                        quantity: i.quantity,
                        tolerance: i.tolerance || 0
                    })))
                }
            } else {
                // Reset Form on Open (New Entry)
                setDate(new Date().toISOString().split('T')[0])
                setCustomerId('')
                setPoNo('')
                setItems([{ category_id: '', product_id: '', quantity: 0, tolerance: 0 }])
            }
        }
    }, [isOpen, initialData])

    const fetchData = async () => {
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
        }
    }

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

        // Auto-set category if product changes
        if (field === 'product_id') {
            const prod = products.find(p => p.id === value)
            if (prod) {
                newItems[index].category_id = prod.category_id
            }
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

            // 1. Determine Ref (New or Existing)
            const soRef = initialData ? doc(db, 'fg_sales_orders', initialData.id) : doc(collection(db, 'fg_sales_orders'));

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
                ...(initialData ? { updatedAt: serverTimestamp() } : { createdAt: serverTimestamp(), createdBy: user?.uid || 'unknown' })
            }

            if (initialData) {
                batch.update(soRef, soData);
            } else {
                batch.set(soRef, soData);
            }

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
                const newSheetRef = doc(collection(db, 'fg_inventory_sheets'));
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

            // 3. Handle Inventory Transactions
            // If Editing: Delete ALL existing transactions for this SO first to avoid dupes/orphans
            if (initialData) {
                const transQuery = query(collection(db, 'fg_inventory_transactions'), where('so_id', '==', initialData.id));
                const transSnap = await getDocs(transQuery);
                transSnap.forEach(doc => {
                    batch.delete(doc.ref);
                });
            }

            // Create Transactions (for both New and Edit)
            items.forEach(item => {
                const prod = products.find(p => p.id === item.product_id)
                const cat = categories.find(c => c.id === item.category_id)

                const newTransRef = doc(collection(db, 'fg_inventory_transactions'));

                batch.set(newTransRef, {
                    sheet_id: sheetId,
                    date: date,
                    type: 'Sales Order',
                    transaction_type: 'Sales Order', // For consistency

                    po_no: poNo,
                    customer_name: customerName,
                    manual_supplier_name: customerName, // Populate for Inventory consistency
                    supplier_name: customerName,

                    category_name: cat?.name || '',
                    manual_category_name: cat?.name || '',

                    product_id: item.product_id, // Add product_id for linking
                    item_code: prod?.item_code || '',
                    product_name: prod?.description || '',
                    manual_product_name: prod?.description || '',

                    uom: prod?.uom || '', // Add UOM

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
            onClose();

        } catch (error) {
            console.error("Error saving sales order:", error)
            alert("Failed to save Sales Order")
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
            <div className="bg-white px-2 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800">{initialData ? 'Edit Sales Order' : 'New Sales Order'}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className="p-6 relative max-h-[85vh] overflow-y-auto">
                    {isLoading && <LoadingOverlay />}

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
                                <SearchableDropdown
                                    options={customers.map(c => ({ id: c.id, label: c.name }))}
                                    value={customerId}
                                    onChange={(val) => setCustomerId(String(val))}
                                    placeholder="Select Customer"
                                />
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

                                        <div className="col-span-4">
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
                                            <SearchableDropdown
                                                options={products
                                                    .filter(p => !customerId || p.customer_id === customerId) // Filter by Customer
                                                    .map(p => ({ id: p.id, label: p.description }))}
                                                value={item.product_id}
                                                onChange={(val) => updateItem(index, 'product_id', val)}
                                                placeholder={customerId ? "Select Product (Linked)" : "Select Customer First"}
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Item Code</label>
                                            <input
                                                type="text"
                                                readOnly
                                                disabled
                                                className="w-full border border-gray-200 bg-gray-100 rounded p-1.5 text-sm font-bold text-gray-700"
                                                value={products.find(p => p.id === item.product_id)?.item_code || ''}
                                                placeholder="Auto"
                                            />
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
                                onClick={onClose}
                                className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-bold shadow-sm"
                                disabled={isLoading}
                            >
                                {isLoading ? 'Saving...' : (initialData ? 'Update Order' : 'Create Sales Order')}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}
