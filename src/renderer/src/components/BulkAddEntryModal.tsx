import React, { useState, useEffect } from 'react'
import { db } from '../firebase'
import { collection, doc, writeBatch, serverTimestamp, increment, getDoc } from 'firebase/firestore'
import { SearchableDropdown } from './SearchableDropdown'
import { getSuppliersForProduct, fetchProductStock } from '../utils/inventoryUtils'

interface BulkAddEntryModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    products: any[]
    suppliers: any[]
    warehouses: any[]
    section: string
    sheetId?: string
}

export const BulkAddEntryModal: React.FC<BulkAddEntryModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    products,
    suppliers,
    warehouses,
    section,
    sheetId
}) => {
    const [rows, setRows] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState('')
    const [jobCards, setJobCards] = useState<any[]>([])

    // Helper to get Warehouse 1
    const getWarehouse1 = () => warehouses.find(w => w.name === 'Warehouse 1') || warehouses[0];

    // Initialize with one empty row and fetch job cards
    useEffect(() => {
        if (isOpen) {
            setRows([]); // Clear any existing rows
            const initialRow = {
                id: Date.now(),
                date: new Date().toISOString().split('T')[0],
                transaction_type: 'Opening', // Default
                document_id: '',
                product_id: '',
                supplier_name: '',
                warehouse_id: '',
                quantity: 0,
                rate: 0,
                description: '',
                current_stock: 0,
                global_stock: 0,
                supplier_stock: 0,
                warehouse_stock: 0,
                calculated_kgs: 0,
                amount: 0,
                relevantSuppliers: [],
                po_no: '',
                job_card_id: ''
            };
            setRows([initialRow]);
            if (section === 'raw_material') fetchJobCards()
        }
    }, [isOpen])

    const fetchJobCards = async () => {
        const { getDocs, collection, query, where } = await import('firebase/firestore')
        try {
            const q = query(
                collection(db, 'job_cards'),
                where('currentPhase', '>=', 3)
            );
            const snap = await getDocs(q);
            const list = snap.docs
                .map(d => ({
                    id: d.id,
                    jobCardNo: d.data().jobCardNo,
                    jobName: d.data().customerData?.jobName || 'Unnamed Job',
                    currentPhase: d.data().currentPhase
                }))
                .filter(jc => jc.currentPhase < 8);
            setJobCards(list);
        } catch (e) {
            console.error("Error fetching job cards:", e)
        }
    }

    const addRow = () => {
        setRows(prev => [...prev, {
            id: Date.now() + Math.random(), // Ensure unique ID even if added fast
            date: new Date().toISOString().split('T')[0],
            transaction_type: 'Opening', // Default
            document_id: '',
            product_id: '',
            supplier_name: '',
            warehouse_id: '',
            quantity: 0,
            rate: 0,
            description: '',
            current_stock: 0, // Used for validation (usually W1 or Supplier depending on context)
            global_stock: 0,
            supplier_stock: 0,
            warehouse_stock: 0,
            calculated_kgs: 0,
            amount: 0,
            relevantSuppliers: [], // Cache for relevant suppliers
            po_no: '', // FG Only
            job_card_id: '' // RM Only
        }])
    }

    const removeRow = (index: number) => {
        const newRows = [...rows]
        newRows.splice(index, 1)
        setRows(newRows)
    }

    const updateRow = async (index: number, field: string, value: any) => {
        const newRows = [...rows]
        const row = newRows[index]
        row[field] = value

        // --- Logic for specific fields ---

        if (field === 'transaction_type') {
            if (value === 'Issue' || value === 'Adjustment') {
                const w1 = getWarehouse1()
                if (w1) {
                    row.warehouse_id = w1.id
                    // Fetch W1 stock immediately if product selected
                    if (row.product_id) {
                        row.warehouse_stock = await fetchProductStock(row.product_id, undefined, w1.id, section)
                        row.current_stock = row.warehouse_stock // Set validation stock
                    }
                }
            } else if (value === 'Opening') {
                row.warehouse_id = ''
                row.warehouse_stock = 0
            }
        }

        if (field === 'product_id') {
            const product = products.find(p => p.id === value)
            if (product) {
                if (row.rate === 0) row.rate = product.rate || 0
                // Calculate Kgs Defaults
                if (product.unit_weight && product.unit_weight > 0) {
                    row.unit_weight = product.unit_weight
                } else {
                    row.length = product.length
                    row.width = product.width
                    row.gsm = product.gsm
                }

                // 1. Fetch Global Stock
                row.global_stock = await fetchProductStock(product.id, undefined, undefined, section)

                // 2. Fetch Relevant Suppliers (Async)
                if (section === 'raw_material') {
                    getSuppliersForProduct(product.id, product.description, section).then(sups => {
                        setRows(prev => {
                            const next = [...prev]
                            if (next[index]) next[index].relevantSuppliers = sups
                            return next
                        })
                    })
                }

                // 3. Reset dependent fields
                row.supplier_name = ''
                row.supplier_stock = 0

                // 4. Update Warehouse Stock if W1/Selected
                if (row.transaction_type === 'Issue' || row.transaction_type === 'Adjustment') {
                    const w1 = getWarehouse1()
                    if (w1) {
                        row.warehouse_stock = await fetchProductStock(row.product_id, undefined, w1.id, section)
                        row.current_stock = row.warehouse_stock
                    }
                } else if (row.warehouse_id) {
                    row.warehouse_stock = await fetchProductStock(row.product_id, undefined, row.warehouse_id, section)
                }
            } else {
                // Reset if cleared
                row.global_stock = 0
                row.relevantSuppliers = []
                row.current_stock = 0
                row.supplier_stock = 0
                row.warehouse_stock = 0
            }
        }

        if (field === 'supplier_name') {
            if (row.product_id && value) {
                row.supplier_stock = await fetchProductStock(row.product_id, value, undefined, section)
            } else {
                row.supplier_stock = 0
            }
        }

        if (field === 'warehouse_id') {
            if (row.product_id && value) {
                row.warehouse_stock = await fetchProductStock(row.product_id, undefined, value, section)
                // If Opening, maybe set validation stock? Opening is creating stock, so validation not needed usually.
            } else {
                row.warehouse_stock = 0
            }
        }

        // Re-Calculate Kgs & Amount
        const qty = Number(row.quantity || 0)
        let kgs = 0
        const product = products.find(p => p.id === row.product_id)

        if (product) {
            if (product.unit_weight && product.unit_weight > 0) {
                kgs = product.unit_weight * qty
                if (product.allow_decimals === false) kgs = Math.floor(kgs)
                else kgs = Number(kgs.toFixed(2))
            } else if (product.length && product.width && product.gsm) {
                kgs = Number(((product.length * 25.4 / 1000) * (product.width * 25.4 / 1000) * (product.gsm / 1000) * qty).toFixed(2))
            }
        }
        row.calculated_kgs = kgs
        row.amount = Number((qty * Number(row.rate || 0)).toFixed(2))

        setRows(newRows)
    }

    const handleSave = async () => {
        const withTimeout = async <T,>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
            const timeout = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`TIMEOUT: ${errorMessage}`)), ms);
            });
            return Promise.race([promise, timeout]);
        };

        // Validation
        setError('')
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]
            if (!row.product_id) {
                setError(`Row ${i + 1}: Product is required.`)
                return
            }
            if (!row.quantity || Number(row.quantity) <= 0) {
                setError(`Row ${i + 1}: Quantity must be greater than 0.`)
                return
            }
            if (section === 'raw_material') {
                if (row.transaction_type === 'Opening' && !row.warehouse_id) {
                    setError(`Row ${i + 1}: Warehouse is required for Opening stock.`)
                    return
                }
                if (!row.document_id) {
                    setError(`Row ${i + 1}: Document ID is required.`)
                    return
                }
                if (row.transaction_type === 'Issue') {
                    // Check Stock
                    // Use the specific warehouse stock we fetched
                    if (row.warehouse_stock < Number(row.quantity)) {
                        setError(`Row ${i + 1}: Insufficient stock for Issue. Available in Warehouse: ${row.warehouse_stock}`)
                        return
                    }
                }
            }
        }

        setIsLoading(true)

        try {
            const batch = writeBatch(db)
            const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products'
            const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions'

            // 1. Resolve Sheets (Simplified: Group by Month/Year)
            const rowsByMonthYear: { [key: string]: any[] } = {}
            rows.forEach(row => {
                const d = new Date(row.date)
                const key = `${d.getMonth() + 1}-${d.getFullYear()}`
                if (!rowsByMonthYear[key]) rowsByMonthYear[key] = []
                rowsByMonthYear[key].push(row)
            })

            const sheetIds: { [key: string]: string } = {}
            const newSheetsToCreate: { [key: string]: { ref: any, data: any } } = {}

            // Helper for sheet creation
            const { query, where, getDocs, collection } = await import('firebase/firestore')

            for (const key of Object.keys(rowsByMonthYear)) {
                const [month, year] = key.split('-').map(Number)
                const q2 = query(collection(db, section === 'finished_goods' ? 'fg_inventory_sheets' : 'rm_inventory_sheets'),
                    where('month', '==', month),
                    where('year', '==', year),
                    where('section', '==', section)
                )
                const snap = await withTimeout(getDocs(q2), 30000, `Resolving sheet for ${key}`)
                if (!snap.empty) {
                    sheetIds[key] = snap.docs[0].id
                } else {
                    const sheetColl = section === 'finished_goods' ? 'fg_inventory_sheets' : 'rm_inventory_sheets'
                    const sheetRef = doc(collection(db, sheetColl))
                    newSheetsToCreate[key] = {
                        ref: sheetRef,
                        data: {
                            month,
                            year,
                            section,
                            createdAt: serverTimestamp(),
                            isLocked: false
                        }
                    }
                    sheetIds[key] = sheetRef.id
                }
            }

            // 2. Prepare and Commit Batches (500 limit)
            const batches = [];
            let currentBatch = writeBatch(db);
            let currentBatchSize = 0;

            // --- ATOMICITY: Include ALL NEW sheets in the very first batch ---
            for (const key of Object.keys(newSheetsToCreate)) {
                const sheet = newSheetsToCreate[key]
                currentBatch.set(sheet.ref, sheet.data)
                currentBatchSize++
            }

            for (const row of rows) {
                if (currentBatchSize >= 500) {
                    batches.push(currentBatch);
                    currentBatch = writeBatch(db);
                    currentBatchSize = 0;
                }

                const d = new Date(row.date)
                const key = `${d.getMonth() + 1}-${d.getFullYear()}`
                const currentSheetId = sheetIds[key]

                const product = products.find(p => p.id === row.product_id)
                const qtyNum = Number(row.quantity)
                const finalQty = row.transaction_type === 'Issue' ? -Math.abs(qtyNum) : Math.abs(qtyNum)

                const transRef = doc(collection(db, transCollName))
                currentBatch.set(transRef, {
                    sheet_id: currentSheetId,
                    date: row.date,
                    product_id: row.product_id,
                    item_code: product?.item_code || '',
                    product_name: product?.description || 'Unknown',
                    transaction_type: row.transaction_type,
                    quantity: finalQty,
                    rate: Number(row.rate),
                    amount: row.amount,
                    calculated_kgs: row.calculated_kgs,
                    supplier_name: row.supplier_name || null,
                    warehouse_id: row.warehouse_id || null,
                    warehouse_name: warehouses.find(w => w.id === row.warehouse_id)?.name || null,
                    description: row.description || '',
                    section: section,
                    createdAt: serverTimestamp(),
                    grn_no: row.document_id || '',
                    category_name: product?.category_name || '',
                    uom: product?.uom || '',
                    length: product?.length || 0,
                    width: product?.width || 0,
                    gsm: product?.gsm || 0,
                    po_no: row.po_no || '',
                    customer_po_no: row.po_no || '',
                    job_card_id: row.job_card_id || null
                })
                currentBatchSize++;

                if (row.transaction_type !== 'Opening') {
                    if (currentBatchSize >= 500) {
                        batches.push(currentBatch);
                        currentBatch = writeBatch(db);
                        currentBatchSize = 0;
                    }
                    const prodRef = doc(db, prodCollName, row.product_id)
                    currentBatch.update(prodRef, {
                        current_stock: increment(finalQty),
                        updatedAt: serverTimestamp()
                    })
                    currentBatchSize++;

                    if (section === 'raw_material') {
                        if (row.supplier_name) {
                            if (currentBatchSize >= 500) {
                                batches.push(currentBatch);
                                currentBatch = writeBatch(db);
                                currentBatchSize = 0;
                            }
                            const suppRef = doc(db, prodCollName, row.product_id, 'supplier_stock', row.supplier_name)
                            currentBatch.set(suppRef, { current_stock: increment(finalQty), updatedAt: serverTimestamp() }, { merge: true })
                            currentBatchSize++;
                        }
                        if (row.warehouse_id) {
                            if (currentBatchSize >= 500) {
                                batches.push(currentBatch);
                                currentBatch = writeBatch(db);
                                currentBatchSize = 0;
                            }
                            const whRef = doc(db, prodCollName, row.product_id, 'warehouse_stock', row.warehouse_id)
                            currentBatch.set(whRef, { current_stock: increment(finalQty), updatedAt: serverTimestamp() }, { merge: true })
                            currentBatchSize++;
                        }
                    }
                }
            }

            // 3. Handle Job Card Phase Progression (Bulk)
            const jcIdsToUpdate = new Set<string>();
            for (const row of rows) {
                if (section === 'raw_material' && row.transaction_type === 'Issue' && row.job_card_id) {
                    jcIdsToUpdate.add(row.job_card_id);
                }
            }

            for (const jcId of jcIdsToUpdate) {
                if (currentBatchSize >= 500) {
                    batches.push(currentBatch);
                    currentBatch = writeBatch(db);
                    currentBatchSize = 0;
                }
                const jcRef = doc(db, 'job_cards', jcId);
                const jcSnap = await getDoc(jcRef);
                if (jcSnap.exists()) {
                    const jcData = jcSnap.data();
                    if (jcData.currentPhase === 4) {
                        currentBatch.update(jcRef, {
                            currentPhase: 5,
                            'phaseStatuses.4': 'completed',
                            updatedAt: serverTimestamp()
                        });
                        currentBatchSize++;
                    }
                }
            }

            if (currentBatchSize > 0) batches.push(currentBatch);

            console.log(`[BulkSave] Committing ${batches.length} batches...`);
            for (let i = 0; i < batches.length; i++) {
                console.log(`[BulkSave] Committing batch ${i + 1}/${batches.length}...`);
                await withTimeout(batches[i].commit(), 60000, `Committing batch ${i + 1}`);
            }
            onSuccess()
            onClose()
            // setRows([]) // useEffect on isOpen handles reset now

        } catch (e: any) {
            console.error("Bulk Save Error:", e)
            if (e.message?.includes('TIMEOUT')) {
                setError("Operation Timed Out: Firestore is taking too long to respond. This usually happens if you've exceeded your daily quota and Firebase is retrying. Please try again later.")
            } else if (e.code === 'resource-exhausted' || e.message?.includes('quota')) {
                setError("Firebase Quota Exceeded: You have reached the daily write limit for your current plan. Please wait 24 hours or upgrade to the Blaze plan.")
            } else {
                setError(e.message)
            }
        } finally {
            setIsLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[110] backdrop-blur-sm">
            <div className="bg-white w-full max-w-[95vw] h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                        </svg>
                        Bulk Inventory Entry
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-4 bg-gray-100">
                    {error && (
                        <div className="mb-4 p-3 bg-red-100 border border-red-200 text-red-700 rounded-lg flex items-center gap-2 animate-pulse">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            {error}
                        </div>
                    )}

                    <div className="w-full bg-white shadow-sm rounded-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1200px]">
                                <thead className="bg-gray-50 border-b whitespace-nowrap">
                                    <tr>
                                        <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase sticky left-0 bg-gray-50 z-10 w-12">#</th>
                                        {section === 'raw_material' && <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase w-32">Document ID</th>}
                                        <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase w-32">Date</th>
                                        {section === 'finished_goods' && <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase w-32">PO No.</th>}
                                        <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase w-32">Type</th>
                                        <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase min-w-[250px]">Product / Global Stock</th>
                                        <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase min-w-[200px]">Supplier / Stock</th>
                                        {section === 'raw_material' && <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase min-w-[150px]">Warehouse</th>}
                                        {section === 'raw_material' && <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase min-w-[200px]">Job Card</th>}
                                        <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase min-w-[100px] w-24">Qty</th>
                                        <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase min-w-[100px] w-24">Rate</th>
                                        <th className="p-3 text-left text-xs font-bold text-gray-500 uppercase min-w-[120px] w-32">Amount</th>
                                        <th className="p-3 text-center text-xs font-bold text-gray-500 uppercase w-16">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {rows.map((row, index) => {
                                        // Dynamic Warning for Stock
                                        const isIssue = row.transaction_type === 'Issue'
                                        const hasStockError = isIssue && row.warehouse_stock < Number(row.quantity)

                                        // Determine Options for Supplier
                                        const isRestricted = row.transaction_type === 'Issue' || row.transaction_type === 'Adjustment';

                                        let supplierOptions;
                                        if (isRestricted) {
                                            // STRICT: Only use relevantSuppliers. If empty, show none.
                                            supplierOptions = (row.relevantSuppliers || []).map((s: string) => ({ id: s, label: s }));
                                        } else {
                                            // Opening: Show ALL suppliers
                                            supplierOptions = suppliers.map(s => {
                                                const name = typeof s === 'string' ? s : s.name;
                                                return { id: name, label: name }
                                            });
                                        }

                                        return (
                                            <tr key={row.id} className={`hover:bg-gray-50 transition-colors ${hasStockError ? 'bg-red-50' : ''} align-top`}>
                                                <td className="p-3 text-gray-400 text-sm font-mono sticky left-0 bg-white">{index + 1}</td>
                                                {section === 'raw_material' && (
                                                    <td className="p-2">
                                                        <input
                                                            type="text"
                                                            value={row.document_id}
                                                            onChange={e => updateRow(index, 'document_id', e.target.value)}
                                                            className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                            placeholder="Doc ID"
                                                        />
                                                    </td>
                                                )}
                                                <td className="p-2">
                                                    <input
                                                        type="date"
                                                        value={row.date}
                                                        onChange={e => updateRow(index, 'date', e.target.value)}
                                                        className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                    />
                                                </td>
                                                {section === 'finished_goods' && (
                                                    <td className="p-2">
                                                        <input
                                                            type="text"
                                                            value={row.po_no}
                                                            onChange={e => updateRow(index, 'po_no', e.target.value)}
                                                            className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                            placeholder="PO No"
                                                        />
                                                    </td>
                                                )}
                                                <td className="p-2">
                                                    <select
                                                        value={row.transaction_type}
                                                        onChange={e => updateRow(index, 'transaction_type', e.target.value)}
                                                        className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                    >
                                                        <option value="Opening">Opening</option>
                                                        {section === 'finished_goods' ? (
                                                            <>
                                                                <option value="Sales Order">Sales Order</option>
                                                                <option value="Manufactured Product">Manufactured Product</option>
                                                                <option value="Delivery Note">Delivery Note</option>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <option value="Issue">Issue</option>
                                                                <option value="Adjustment">Adjustment</option>
                                                            </>
                                                        )}
                                                    </select>
                                                </td>
                                                <td className="p-2">
                                                    <SearchableDropdown
                                                        options={products.map(p => ({ id: p.id, label: p.description }))}
                                                        value={row.product_id}
                                                        onChange={(val) => updateRow(index, 'product_id', val)}
                                                        placeholder="Select Product..."
                                                    />
                                                    {row.product_id && (
                                                        <div className="text-xs text-blue-600 mt-1 font-medium bg-blue-50 px-2 py-0.5 rounded inline-block">
                                                            Global Stock: {row.global_stock ?? 0}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-2">
                                                    <SearchableDropdown
                                                        options={supplierOptions}
                                                        value={row.supplier_name}
                                                        onChange={(val) => updateRow(index, 'supplier_name', val)}
                                                        placeholder="Select Supplier..."
                                                    />
                                                    {row.supplier_name && (
                                                        <div className="text-xs text-green-600 mt-1 font-medium bg-green-50 px-2 py-0.5 rounded inline-block">
                                                            Supplier Stock: {row.supplier_stock ?? 0}
                                                        </div>
                                                    )}
                                                </td>
                                                {section === 'raw_material' && (
                                                    <td className="p-2">
                                                        {row.transaction_type === 'Opening' ? (
                                                            <select
                                                                value={row.warehouse_id}
                                                                onChange={e => updateRow(index, 'warehouse_id', e.target.value)}
                                                                className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                            >
                                                                <option value="">Select Warehouse...</option>
                                                                {warehouses.map(w => (
                                                                    <option key={w.id} value={w.id}>{w.name}</option>
                                                                ))}
                                                            </select>
                                                        ) : (
                                                            <div className="text-sm text-gray-500 px-2 italic h-[30px] flex items-center">
                                                                {warehouses.find(w => w.id === row.warehouse_id)?.name || 'Warehouse 1'}
                                                            </div>
                                                        )}
                                                        {(row.warehouse_id || row.transaction_type !== 'Opening') && (
                                                            <div className="text-xs text-purple-600 mt-1 font-medium bg-purple-50 px-2 py-0.5 rounded inline-block">
                                                                Wh Stock: {row.warehouse_stock ?? 0}
                                                            </div>
                                                        )}
                                                    </td>
                                                )}
                                                {section === 'raw_material' && (
                                                    <td className="p-2">
                                                        <SearchableDropdown
                                                            options={jobCards.map(jc => ({ id: jc.id, label: `${jc.jobCardNo} - ${jc.jobName}` }))}
                                                            value={row.job_card_id}
                                                            onChange={(val) => updateRow(index, 'job_card_id', val)}
                                                            placeholder="Select Job Card..."
                                                        />
                                                    </td>
                                                )}
                                                <td className="p-2 min-w-[100px]">
                                                    <input
                                                        type="number"
                                                        value={row.quantity}
                                                        onChange={e => updateRow(index, 'quantity', e.target.value)}
                                                        className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-right"
                                                        placeholder="0"
                                                    />
                                                </td>
                                                <td className="p-2 min-w-[100px]">
                                                    <input
                                                        type="number"
                                                        value={row.rate}
                                                        onChange={e => updateRow(index, 'rate', e.target.value)}
                                                        className="w-full border rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none text-right"
                                                        placeholder="0.00"
                                                    />
                                                </td>
                                                <td className="p-3 text-right text-sm font-bold text-gray-700 min-w-[120px]">
                                                    {row.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                </td>
                                                <td className="p-2 text-center min-w-[80px]">
                                                    <button
                                                        onClick={() => removeRow(index)}
                                                        className="p-1 hover:bg-red-100 rounded text-red-500 transition-colors"
                                                        title="Remove Row"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                                <tfoot className="bg-gray-50 border-t">
                                    <tr>
                                        <td colSpan={section === 'raw_material' ? 10 : 8} className="p-2">
                                            <button
                                                onClick={addRow}
                                                className="flex items-center gap-2 text-blue-600 font-bold text-sm px-4 py-2 hover:bg-blue-50 rounded-lg transition-colors"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                                                </svg>
                                                Add Another Row
                                            </button>
                                        </td>
                                        <td></td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 rounded-lg text-gray-600 font-bold hover:bg-gray-200 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isLoading}
                        className={`px-8 py-2 rounded-lg text-white font-bold shadow-md flex items-center gap-2 ${isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 hover:shadow-lg transition-all'}`}
                    >
                        {isLoading ? (
                            <>
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Saving...
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                Save All Entries
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
