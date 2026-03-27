import React, { useState, useEffect } from 'react'
import { ConfirmationModal } from './ConfirmationModal'
import { SearchableDropdown } from './SearchableDropdown'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase'
import {
    collection,
    getDocs,
    serverTimestamp,
    query,
    orderBy,
    where,
    writeBatch,
    doc,
    increment,
    updateDoc
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

interface AddProductionModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    initialData?: any // For editing
}

export const AddProductionModal: React.FC<AddProductionModalProps> = ({ isOpen, onClose, onSuccess, initialData }) => {
    const { user } = useAuth()
    const [isLoading, setIsLoading] = useState(false)
    const [salesOrders, setSalesOrders] = useState<any[]>([])
    const [products, setProducts] = useState<any[]>([])

    // Form State
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [selectedPO, setSelectedPO] = useState('')
    const [items, setItems] = useState<any[]>([
        { product_id: '', box_qty: 0, qty_per_box: 0, total_qty: 0, has_short_item: false, short_box_qty: 0, short_qty_per_box: 0, short_total_qty: 0 }
    ])

    const [infoModal, setInfoModal] = useState<{ isOpen: boolean, title: string, message: string }>({ isOpen: false, title: '', message: '' })

    useEffect(() => {
        if (isOpen) {
            fetchData()
            if (initialData) {
                // Populate Form for Editing
                setDate(initialData.date)
                setSelectedPO(initialData.po_no)
                // Editing implies single transaction = single item
                setItems([{
                    product_id: initialData.product_id,
                    box_qty: initialData.box_qty,
                    qty_per_box: initialData.qty_per_box,
                    total_qty: initialData.quantity // Use 'quantity' from transaction which is total
                }])
            } else {
                // Reset Form
                setDate(new Date().toISOString().split('T')[0])
                setSelectedPO('')
                setItems([{ product_id: '', box_qty: 0, qty_per_box: 0, total_qty: 0, has_short_item: false, short_box_qty: 0, short_qty_per_box: 0, short_total_qty: 0 }])
            }
        }
    }, [isOpen, initialData])

    const fetchData = async () => {
        setIsLoading(true)
        try {
            // Fetch Sales Orders
            const q = query(collection(db, 'fg_sales_orders'), orderBy('createdAt', 'desc'));
            const soSnap = await getDocs(q);
            setSalesOrders(soSnap.docs.map(d => ({ id: d.id, ...d.data() })));

            // Fetch Products
            const pSnap = await getDocs(collection(db, 'fg_products'));
            setProducts(pSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        } catch (error) {
            console.error("Error fetching data:", error)
        } finally {
            setIsLoading(false)
        }
    }

    const addItem = () => {
        setItems([...items, { product_id: '', box_qty: 0, qty_per_box: 0, total_qty: 0, has_short_item: false, short_box_qty: 0, short_qty_per_box: 0, short_total_qty: 0 }])
    }

    const removeItem = (index: number) => {
        const newItems = [...items]
        newItems.splice(index, 1)
        setItems(newItems)
    }

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...items]
        const val = Number(value);
        newItems[index][field] = value

        // Auto Calculate Total
        if (field === 'box_qty' || field === 'qty_per_box') {
            const b = field === 'box_qty' ? val : Number(newItems[index].box_qty);
            const q = field === 'qty_per_box' ? val : Number(newItems[index].qty_per_box);
            newItems[index].total_qty = b * q;
        }

        // Auto Calculate Short Total
        if (field === 'short_box_qty' || field === 'short_qty_per_box') {
            const sb = field === 'short_box_qty' ? val : Number(newItems[index].short_box_qty || 0);
            const sq = field === 'short_qty_per_box' ? val : Number(newItems[index].short_qty_per_box || 0);
            newItems[index].short_total_qty = sb * sq;
        }

        setItems(newItems)
    }

    // Filter Products based on Selected PO
    const filteredProducts = React.useMemo(() => {
        if (!selectedPO) return products;

        const so = salesOrders.find(s => s.po_no === selectedPO);
        if (!so || !so.items) return products; // Fallback to all

        const soProductIds = new Set(so.items.map((i: any) => i.product_id));
        return products.filter(p => soProductIds.has(p.id));

    }, [selectedPO, products, salesOrders]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedPO) {
            setInfoModal({ isOpen: true, title: 'Missing Information', message: 'Please select a PO.' })
            return
        }

        setIsLoading(true)
        try {
            const so = salesOrders.find(s => s.po_no === selectedPO);
            const customerName = so?.customer_name || '';
            const batch = writeBatch(db);

            if (initialData) {
                // EDIT LOGIC (Single Item)
                const item = items[0];
                const prod = products.find(p => p.id === item.product_id);
                const categoryName = prod?.category_name || '';

                const transRef = doc(db, 'fg_inventory_transactions', initialData.id);

                // Calculate Diff for Stock Adjustment
                const oldQty = Number(initialData.quantity);
                const newQty = Number(item.total_qty);
                const stockDiff = newQty - oldQty;

                // Update Transaction
                batch.update(transRef, {
                    date: date,
                    job_card_id: so?.job_card_id || null, // Link to Job Card
                    po_no: selectedPO,
                    po_id: so?.id || null,
                    customer_name: customerName,
                    manual_supplier_name: customerName,
                    category_name: categoryName,
                    manual_category_name: categoryName,
                    product_id: item.product_id,
                    product_name: prod?.description || '',
                    manual_product_name: prod?.description || '',
                    uom: prod?.uom || '',
                    quantity: newQty,
                    display_quantity: newQty,
                    box_qty: Number(item.box_qty),
                    qty_per_box: Number(item.qty_per_box),
                    updatedAt: serverTimestamp()
                });

                // Update Product Stock (Apply Difference)
                if (stockDiff !== 0) {
                    const prodRef = doc(db, 'fg_products', item.product_id);
                    batch.update(prodRef, {
                        current_stock: increment(stockDiff),
                        updatedAt: serverTimestamp()
                    });
                }
            } else {
                // CREATE LOGIC (Multiple Items)
                // Resolve Sheet
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

                // Create Entries
                for (const item of items) {
                    if (!item.product_id) continue;

                    const prod = products.find(p => p.id === item.product_id);
                    const categoryName = prod?.category_name || '';

                    // 1. Transaction
                    const newTransRef = doc(collection(db, 'fg_inventory_transactions'));
                    batch.set(newTransRef, {
                        sheet_id: sheetId,
                        job_card_id: so?.job_card_id || null, // Link to Job Card
                        date: date,
                        type: 'Manufactured Product',
                        transaction_type: 'Manufactured Product',
                        po_no: selectedPO,
                        po_id: so?.id || null,
                        customer_name: customerName,
                        manual_supplier_name: customerName,
                        category_name: categoryName,
                        manual_category_name: categoryName,
                        product_id: item.product_id,
                        item_code: prod?.item_code || '',
                        product_name: prod?.description || '',
                        manual_product_name: prod?.description || '',
                        uom: prod?.uom || '',
                        quantity: Number(item.total_qty),
                        display_quantity: Number(item.total_qty),
                        box_qty: Number(item.box_qty),
                        qty_per_box: Number(item.qty_per_box),
                        createdAt: serverTimestamp(),
                        section: 'finished_goods'
                    });

                    // 2. Update Product Stock (Main)
                    const prodRef = doc(db, 'fg_products', item.product_id);
                    batch.update(prodRef, {
                        current_stock: increment(Number(item.total_qty)),
                        updatedAt: serverTimestamp()
                    });

                    // 3. Short Item Transaction (If applicable)
                    if (item.has_short_item && item.short_total_qty > 0) {
                        const shortTransRef = doc(collection(db, 'fg_inventory_transactions'));
                        batch.set(shortTransRef, {
                            sheet_id: sheetId,
                            job_card_id: so?.job_card_id || null, // Link to Job Card
                            date: date,
                            type: 'Manufactured Product',
                            transaction_type: 'Manufactured Product',

                            po_no: selectedPO,
                            po_id: so?.id || null,
                            customer_name: customerName,
                            manual_supplier_name: customerName,

                            category_name: categoryName,
                            manual_category_name: categoryName,

                            product_id: item.product_id,
                            item_code: prod?.item_code || '',
                            product_name: prod?.description || '',
                            manual_product_name: prod?.description || '',
                            uom: prod?.uom || '',

                            // Stock Impact: POSITIVE
                            quantity: Number(item.short_total_qty),
                            display_quantity: Number(item.short_total_qty),

                            box_qty: Number(item.short_box_qty),
                            qty_per_box: Number(item.short_qty_per_box),
                            is_short_item_entry: true, // Flag for reference

                            createdAt: serverTimestamp(),
                            section: 'finished_goods'
                        });

                        // Update Product Stock (Short)
                        batch.update(prodRef, {
                            current_stock: increment(Number(item.short_total_qty)),
                            updatedAt: serverTimestamp()
                        });
                    }
                }
            }

            await batch.commit();
            onSuccess();
            onClose();

        } catch (error) {
            console.error("Error saving manufactured product:", error)
            setInfoModal({ isOpen: true, title: 'Error', message: 'Failed to save. Please try again.' })
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
            <div className="bg-white px-2 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center">
                    <h2 className="text-xl font-bold text-gray-800">Add Production Entry</h2>
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
                                <label className="block text-sm font-bold text-gray-700 mb-2">P.O. Number</label>
                                <SearchableDropdown
                                    options={Array.from(new Set(salesOrders.map(s => s.po_no))).map(po => ({ id: po, label: po }))}
                                    value={selectedPO}
                                    onChange={(val) => setSelectedPO(String(val))}
                                    placeholder="Select PO"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Customer Name</label>
                                <input
                                    type="text"
                                    readOnly
                                    className="w-full border border-gray-300 bg-gray-100 rounded-md p-2 text-gray-600 font-medium"
                                    value={selectedPO ? (salesOrders.find(s => s.po_no === selectedPO)?.customer_name || 'Unknown Customer') : 'Select PO first'}
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
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Product</label>
                                            <SearchableDropdown
                                                options={filteredProducts.map(p => ({ id: p.id, label: p.description }))}
                                                value={item.product_id}
                                                onChange={(val) => updateItem(index, 'product_id', val)}
                                                placeholder="Select Product"
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
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Box Qty</label>
                                            <input
                                                type="number"
                                                required
                                                min="0"
                                                className="w-full border border-gray-300 rounded p-1.5 text-sm"
                                                value={item.box_qty}
                                                onChange={e => updateItem(index, 'box_qty', e.target.value)}
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Qty per Box</label>
                                            <input
                                                type="number"
                                                required
                                                min="0"
                                                className="w-full border border-gray-300 rounded p-1.5 text-sm"
                                                value={item.qty_per_box}
                                                onChange={e => updateItem(index, 'qty_per_box', e.target.value)}
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Total Qty</label>
                                            <input
                                                type="number"
                                                readOnly
                                                disabled
                                                className="w-full border border-gray-200 bg-gray-100 rounded p-1.5 text-sm font-bold text-gray-700"
                                                value={item.total_qty}
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


                                        {/* Short Item Section */}
                                        <div className="col-span-12 border-t pt-2 mt-1">
                                            <label className="flex items-center gap-2 text-sm font-bold text-gray-600 mb-2 cursor-pointer w-fit">
                                                <input
                                                    type="checkbox"
                                                    checked={item.has_short_item || false}
                                                    onChange={e => updateItem(index, 'has_short_item', e.target.checked)}
                                                    className="w-4 h-4 text-blue-600 rounded"
                                                />
                                                Add Short Item?
                                            </label>

                                            {item.has_short_item && (
                                                <div className="grid grid-cols-12 gap-4 bg-orange-50 p-3 rounded border border-orange-100 animate-in fade-in slide-in-from-top-2">
                                                    <div className="col-span-2 col-start-5">
                                                        <label className="block text-xs font-medium text-gray-500 mb-1">Short Box Qty</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            className="w-full border border-orange-300 rounded p-1.5 text-sm bg-white"
                                                            value={item.short_box_qty || 0}
                                                            onChange={e => updateItem(index, 'short_box_qty', e.target.value)}
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <label className="block text-xs font-medium text-gray-500 mb-1">Short Qty/Box</label>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            className="w-full border border-orange-300 rounded p-1.5 text-sm bg-white"
                                                            value={item.short_qty_per_box || 0}
                                                            onChange={e => updateItem(index, 'short_qty_per_box', e.target.value)}
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <label className="block text-xs font-medium text-gray-500 mb-1">Short Total</label>
                                                        <input
                                                            type="number"
                                                            readOnly
                                                            disabled
                                                            className="w-full border border-orange-200 bg-orange-100 rounded p-1.5 text-sm font-bold text-gray-700"
                                                            value={item.short_total_qty || 0}
                                                        />
                                                    </div>
                                                    <div className="col-span-4 flex items-center text-xs text-orange-600 italic">
                                                        * This will create a separate transaction row.
                                                    </div>
                                                </div>
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
                                {isLoading ? 'Saving...' : 'Save Production Log'}
                            </button>
                        </div>
                    </form>
                </div>
            </div >

            <ConfirmationModal
                isOpen={infoModal.isOpen}
                title={infoModal.title}
                message={infoModal.message}
                onConfirm={() => setInfoModal({ ...infoModal, isOpen: false })}
                onCancel={() => setInfoModal({ ...infoModal, isOpen: false })}
                confirmText="OK"
                cancelText="Close"
            />
        </div >
    )
}
