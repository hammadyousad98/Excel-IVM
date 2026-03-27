import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
// Ensure your ../utils/pdfGenerator has a 'blob' mode implemented
import { generatePOPdf, generateDeliveryNote } from '../utils/pdfGenerator'
import * as XLSX from 'xlsx'
import editIcon from '../assets/edit.png'
import deleteIcon from '../assets/delete.png' // Import Delete Icon
import saveIcon from '../assets/save.png'
import printIcon from '../assets/print.png'
import inventoryIcon from '../assets/inventory.png'
import filterIcon from '../assets/filter.png'
import sortIcon from '../assets/sortingArrows.png'
import statusIcon from '../assets/reload.png' // You might need to add this asset or use another one
import { ConfirmationModal } from './ConfirmationModal'
import { UpdateDNStatusModal } from './UpdateDNStatusModal'
import { db } from '../firebase'
import {
    collection,
    onSnapshot,
    query,
    where,
    doc,
    updateDoc,
    setDoc, // Changed to setDoc to allow custom IDs
    getDoc, // Added to check for ID collisions
    orderBy,
    serverTimestamp,
    writeBatch,
    getDocs,
    increment, // Added increment for inventory logic
    deleteDoc // Added for Delete functionality
} from 'firebase/firestore'
import { saveUserLayout, getUserLayout, resetUserLayout } from '../utils/userLayoutService'
import { useGridState } from '../hooks/useGridState'

// Loading Component
const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[200] backdrop-blur-sm">
        <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
            <div className="text-gray-700 font-bold text-lg">Processing...</div>
        </div>
    </div>
)

const formatCurrency = (amount: any) => {
    const val = Number(amount || 0);
    return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const formatNumber = (num: any) => {
    const val = Number(num || 0);
    return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const formatDate = (params: any) => {
    const value = params.value;
    if (!value) return '';
    try {
        let date: Date;
        if (value?.toDate && typeof value.toDate === 'function') {
            date = value.toDate();
        } else if (value?.seconds) {
            date = new Date(value.seconds * 1000);
        } else {
            date = new Date(value);
        }

        if (isNaN(date.getTime())) return value;
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    } catch (e) {
        return value;
    }
}

// --- Helper: Generate Short Custom ID (PO-XXX) ---
// Tries to generate a 3-char ID. If collisions occur frequently, it automatically expands the length.
const generatePOId = async (section: string, attempt = 0): Promise<string> => {
    // 1. Define characters (removed visually similar chars like I, 1, 0, O)
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

    // 2. Determine length: Start with 3 characters.
    // If we have failed (collided) 10 times recursively, increase length to 4, etc.
    // This satisfies the "if full start adding another digit" requirement.
    const length = 3 + Math.floor(attempt / 10);

    let suffix = '';
    for (let i = 0; i < length; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const prefix = section === 'finished_goods' ? 'DO' : 'PO';
    const id = `${prefix}-${suffix}`;
    const collectionName = section === 'finished_goods' ? 'fg_delivery_orders' : 'rm_purchase_orders';

    try {
        // 3. Check if this ID already exists in Database
        const docRef = doc(db, collectionName, id);
        const snapshot = await getDoc(docRef);

        if (snapshot.exists()) {
            // Collision detected, try again with incremented attempt counter
            return generatePOId(section, attempt + 1);
        }

        return id;
    } catch (error) {
        console.error("Error generating ID:", error);
        throw error;
    }
}

// --- Column Manager Component ---
const ColumnManager: React.FC<{ api: any; onClose: () => void; gridId: string }> = ({ api, onClose, gridId }) => {
    const [columns, setColumns] = useState<any[]>([])
    const { user } = useAuth()
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        if (!api) return
        const cols = api.getColumns()
        if (cols) {
            setColumns(cols.map((col: any) => ({
                id: col.getColId(),
                headerName: col.getColDef().headerName || (col.getColId() === '0' ? 'Actions' : col.getColId()),
                visible: col.isVisible(),
                pinned: col.getPinned()
            })))
        }
    }, [api])

    const toggleVisibility = (colId: string, currentVisible: boolean) => {
        api.setColumnVisible(colId, !currentVisible)
        setColumns(prev => prev.map(c => c.id === colId ? { ...c, visible: !currentVisible } : c))
    }

    const togglePin = (colId: string, currentPinned: string | null) => {
        const nextPinned = currentPinned === 'left' ? null : 'left'
        api.applyColumnState({
            state: [{ colId, pinned: nextPinned }],
            defaultState: { pinned: null }
        })
        setColumns(prev => prev.map(c => c.id === colId ? { ...c, pinned: nextPinned } : c))
    }

    const handleSaveLayout = async () => {
        if (!user || !api) return;
        setIsSaving(true);
        try {
            const colState = api.getColumnState();
            await saveUserLayout(user.uid, gridId, colState);
            alert('Column layout saved successfully!');
        } catch (e) {
            console.error("Failed to save layout", e);
            alert('Failed to save layout.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleResetLayout = async () => {
        if (!user || !api) return;
        if (window.confirm('Are you sure you want to reset the column layout to default?')) {
            try {
                await resetUserLayout(user.uid, gridId);
                sessionStorage.removeItem(`ag-grid-state-${gridId}`);
                window.location.reload(); // Quick way to reset grid
            } catch (e) {
                console.error("Failed to reset layout", e);
            }
        }
    };

    return (
        <div className="absolute top-12 right-0 bg-white shadow-2xl border border-gray-200 rounded-xl p-4 z-50 w-72 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
            <div className="flex justify-between items-center mb-3 border-b pb-2">
                <h4 className="font-bold text-gray-700 text-sm">Manage Columns</h4>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
            </div>
            <div className="max-h-[300px] overflow-y-auto pr-1 space-y-1 custom-scrollbar">
                {columns.filter(c => c.headerName !== '' && c.id !== '0').map(col => (
                    <div key={col.id} className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg group">
                        <span className="text-sm text-gray-700 font-medium truncate flex-1" title={col.headerName}>{col.headerName}</span>
                        <div className="flex items-center gap-2">
                            {/* Pin Button */}
                            <button
                                onClick={() => togglePin(col.id, col.pinned)}
                                className={`p-1 rounded transition-colors ${col.pinned === 'left' ? 'bg-blue-100 text-blue-600' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                                title={col.pinned === 'left' ? "Unpin" : "Pin Left"}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
                            </button>
                            {/* Visibility Toggle */}
                            <button
                                onClick={() => toggleVisibility(col.id, col.visible)}
                                className={`p-1 rounded transition-colors ${col.visible ? 'text-green-600 bg-green-50' : 'text-gray-300 hover:text-gray-500'}`}
                                title={col.visible ? "Hide" : "Show"}
                            >
                                {col.visible ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>
                                )}
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-4 pt-3 border-t flex gap-2">
                <button
                    onClick={handleSaveLayout}
                    disabled={isSaving}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded shadow-sm transition-colors disabled:opacity-50"
                >
                    {isSaving ? 'Saving...' : 'Save Layout'}
                </button>
                <button
                    onClick={handleResetLayout}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold py-2 rounded shadow-sm transition-colors"
                >
                    Reset
                </button>
            </div>
        </div>
    )
}

interface PurchaseOrdersProps {
    onEdit?: (po: any) => void
    section?: string
}

export const PurchaseOrders: React.FC<PurchaseOrdersProps> = ({ onEdit, section = 'raw_material' }) => {
    const { user } = useAuth()
    const [pos, setPos] = useState<any[]>([])
    const [companySettings, setCompanySettings] = useState<any>(null)
    const [showPdfOptions, setShowPdfOptions] = useState<{ show: boolean, po: any | null, mode: 'save' | 'print' }>({ show: false, po: null, mode: 'save' })
    const [isLoading, setIsLoading] = useState(false)

    // State for the Confirmation Modal
    const [confirmation, setConfirmation] = useState<{ isOpen: boolean; po: any | null; action: 'inventory' | 'delete' }>({
        isOpen: false,
        po: null,
        action: 'inventory'
    })

    const [syncResult, setSyncResult] = useState<{ isOpen: boolean; title: string; message: string; type: 'success' | 'error' }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'success'
    })

    // DN Status Modal State
    const [dnStatusModal, setDnStatusModal] = useState<{ isOpen: boolean; grnNo: string }>({
        isOpen: false,
        grnNo: ''
    })



    // Ag-Grid API State
    const [gridApi, setGridApi] = useState<any>(null)
    const [showColManager, setShowColManager] = useState(false)
    const [renderError, setRenderError] = useState<string | null>(null)

    const gridStateHandlers = useGridState(`purchase-orders-${section}`, gridApi)

    // --- REAL-TIME DATA SYNC ---
    useEffect(() => {
        setPos([]); // Clear previous data to prevent ghost rows

        const POCollection = section === 'finished_goods' ? 'fg_delivery_orders' : 'rm_purchase_orders';

        // Subscribe to purchase_orders filtered by type
        const q = collection(db, POCollection);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            console.log(`[${section}] Fetched ${snapshot.docs.length} records from DB`); // Debug log
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as any[];

            // Sort Client-side to bypass Index requirement
            data.sort((a, b) => {
                const timeA = a.createdAt?.seconds || 0;
                const timeB = b.createdAt?.seconds || 0;
                return timeB - timeA;
            });

            setPos(data);
            setRenderError(null);
        }, (error) => {
            console.error("Error fetching POs:", error);
            setRenderError("Fetch Error: " + error.message);
        });

        fetchSettings();
        return () => unsubscribe();
    }, [section]);

    const fetchSettings = async () => {
        try {
            const docRef = doc(db, 'settings', 'company_profile');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setCompanySettings(docSnap.data());
            } else {
                console.warn("No company settings found in Firestore.");
            }
        } catch (e) {
            console.error("Settings fetch failed", e);
        }
    }

    const onGridReady = useCallback(async (params: any) => {
        setGridApi(params.api)
        if (user) {
            try {
                const savedState = await getUserLayout(user.uid, `purchase-orders-${section}`);
                if (savedState) {
                    params.api.applyColumnState({ state: savedState, applyOrder: true });
                }
            } catch (e) {
                console.error("Failed to load saved layout", e);
            }
        }
    }, [user, section])

    // Trigger the confirmation modal
    const requestAddToInventory = (po: any) => {
        // Allow re-syncing
        setConfirmation({ isOpen: true, po, action: 'inventory' })
    }

    const requestDelete = (po: any) => {
        setConfirmation({ isOpen: true, po, action: 'delete' })
    }

    // Actual logic to delete PO/DN
    const executeDelete = async () => {
        const po = confirmation.po;
        if (!po) return;

        setIsLoading(true);
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
        const POCollection = section === 'finished_goods' ? 'fg_delivery_orders' : 'rm_purchase_orders';

        try {
            const batch = writeBatch(db);

            // 1. Find existing transactions to reverse stock
            // FIX: Handle both po_id and grn_no lookup to catch duplicates or legacy data
            let transactionDocs: any[] = [];

            // Query 1: By PO ID
            const q1 = query(collection(db, transCollName), where('po_id', '==', po.id));
            const snap1 = await getDocs(q1);
            transactionDocs = [...snap1.docs];

            // Query 2: By GRN/Order No (for FG specifically, to catch POCreate ghosts)
            if (section === 'finished_goods' && po.order_no) {
                const q2 = query(collection(db, transCollName), where('grn_no', '==', po.order_no));
                const snap2 = await getDocs(q2);
                // Merge unique docs
                const existingIds = new Set(transactionDocs.map(d => d.id));
                snap2.docs.forEach(d => {
                    if (!existingIds.has(d.id)) {
                        transactionDocs.push(d);
                    }
                });
            }

            console.log(`[Delete] Found ${transactionDocs.length} transactions to reverse.`);

            for (const tDoc of transactionDocs) {
                const tData = tDoc.data();

                // Reverse Stock Logic
                if (tData.product_id) {
                    const prodRef = doc(db, prodCollName, tData.product_id);

                    // Logic same as re-sync reversal:
                    // RM: Added +Qty. Reversal: -Qty.
                    // FG: Subtracted -Qty. Reversal: +Qty.
                    const reverseQty = section === 'finished_goods' ? Math.abs(Number(tData.quantity)) : -Math.abs(Number(tData.quantity));

                    batch.update(prodRef, {
                        current_stock: increment(reverseQty),
                        updatedAt: serverTimestamp()
                    });

                    // Reverse Supplier Stock (RM Only)
                    if (section === 'raw_material' && tData.supplier_name) {
                        const supplierStockRef = doc(db, prodCollName, tData.product_id, 'supplier_stock', tData.supplier_name);
                        batch.set(supplierStockRef, {
                            current_stock: increment(reverseQty),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }

                    // Reverse Warehouse Stock (RM Only)
                    if (section === 'raw_material' && tData.warehouse_id) {
                        const whStockRef = doc(db, prodCollName, tData.product_id, 'warehouse_stock', tData.warehouse_id);
                        batch.set(whStockRef, {
                            current_stock: increment(reverseQty),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }
                }
                // Delete Transaction
                batch.delete(tDoc.ref);
            }

            // 2. Delete PO Document
            const poRef = doc(db, POCollection, po.id);
            batch.delete(poRef);

            await batch.commit();

            setSyncResult({
                isOpen: true,
                title: 'Deleted',
                message: `${section === 'finished_goods' ? 'Delivery Note' : 'Purchase Order'} and associated inventory deleted successfully.`,
                type: 'success'
            });

        } catch (error: any) {
            console.error("Delete Error:", error);
            setSyncResult({
                isOpen: true,
                title: 'Error',
                message: 'Failed to delete: ' + error.message,
                type: 'error'
            });
        } finally {
            setIsLoading(false);
            setConfirmation({ isOpen: false, po: null, action: 'inventory' }); // Reset with default action
        }
    }

    // Actual logic to add to inventory
    // Now supports RE-SYNCING (Update existing)
    const executeAddToInventory = async () => {
        const po = confirmation.po
        if (!po) return

        setIsLoading(true)
        const sheetCollName = section === 'finished_goods' ? 'fg_inventory_sheets' : 'rm_inventory_sheets';
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
        const poCollName = section === 'finished_goods' ? 'fg_delivery_orders' : 'rm_purchase_orders';

        try {
            const batch = writeBatch(db);
            const poDate = new Date(po.date);
            const poMonth = poDate.getMonth() + 1;
            const poYear = poDate.getFullYear();

            // --- 0. Clean up Previous Sync if any ---
            // Find existing transactions for this PO
            const existingTransQuery = query(collection(db, transCollName), where('po_id', '==', po.id));
            const existingTransSnap = await getDocs(existingTransQuery);

            if (!existingTransSnap.empty) {
                console.log(`[Sync] Found ${existingTransSnap.size} existing transactions. Reversing stock...`);
                for (const tDoc of existingTransSnap.docs) {
                    const tData = tDoc.data();
                    if (tData.product_id) {
                        const prodRef = doc(db, prodCollName, tData.product_id);
                        // Reverse the stock effect (if added, subtract; if removed, add)
                        // FG (Sales) usually subtracts, RM (Purchase) adds. 
                        // We strictly reverse what was done.
                        // However, we rely on the quantity value stored.
                        // RM: Added +Qty. Reverse: -Qty.
                        // FG: Subtracted -Qty. Reverse: +Qty (which is -(-Qty)).

                        // To be safe, look at 'section'.
                        // RM: +Qty. Reverse: -Qty.
                        // FG: -Qty. Reverse: +Qty.
                        // We use Math.abs to be robust against inconsistent stored signs (e.g. if previous code saved +10 for Sale)
                        const reverseQty = section === 'finished_goods' ? Math.abs(Number(tData.quantity)) : -Math.abs(Number(tData.quantity));

                        batch.update(prodRef, {
                            current_stock: increment(reverseQty),
                            updatedAt: serverTimestamp()
                        });

                        // Reverse Supplier Stock (RM Only)
                        if (section === 'raw_material' && tData.supplier_name) {
                            const supplierStockRef = doc(db, prodCollName, tData.product_id, 'supplier_stock', tData.supplier_name);
                            batch.set(supplierStockRef, {
                                current_stock: increment(reverseQty),
                                updatedAt: serverTimestamp()
                            }, { merge: true });
                        }

                        // Reverse Warehouse Stock (RM Only)
                        if (section === 'raw_material' && tData.warehouse_id) {
                            const whStockRef = doc(db, prodCollName, tData.product_id, 'warehouse_stock', tData.warehouse_id);
                            batch.set(whStockRef, {
                                current_stock: increment(reverseQty),
                                updatedAt: serverTimestamp()
                            }, { merge: true });
                        }
                    }
                    batch.delete(tDoc.ref);
                }
            }

            // 1. Resolve Inventory Sheet
            // Check if a sheet exists for this month/year/section
            const sheetsQuery = query(
                collection(db, sheetCollName),
                where('month', '==', poMonth),
                where('year', '==', poYear),
                where('section', '==', section)
            );
            const sheetsSnapshot = await getDocs(sheetsQuery);

            let sheetId: string;

            if (sheetsSnapshot.empty) {
                // Create new sheet
                const newSheetRef = doc(collection(db, sheetCollName));
                batch.set(newSheetRef, {
                    month: poMonth,
                    year: poYear,
                    section: section,
                    createdAt: serverTimestamp()
                });
                sheetId = newSheetRef.id;
            } else {
                sheetId = sheetsSnapshot.docs[0].id;
            }

            // 2. Create Transactions & Update Stock
            for (const item of po.items) {
                // Fetch Product Details for Category/UOM if needed
                let categoryName = '';
                let uom = item.uom || '';

                if (item.product_id) {
                    const productRef = doc(db, prodCollName, item.product_id);
                    const productSnap = await getDoc(productRef);
                    if (productSnap.exists()) {
                        const pData = productSnap.data();
                        categoryName = pData.category_name || '';
                        if (!uom) uom = pData.uom || '';

                        // Update Global Stock
                        const qtyChange = section === 'finished_goods' ? -Number(item.quantity) : Number(item.quantity);
                        batch.update(productRef, {
                            current_stock: increment(qtyChange),
                            updatedAt: serverTimestamp()
                        });

                        // Update Supplier Stock (RM Only)
                        if (section === 'raw_material' && po.supplier_name) {
                            const supplierStockRef = doc(db, prodCollName, item.product_id, 'supplier_stock', po.supplier_name);
                            // Use set with merge to ensure doc exists
                            batch.set(supplierStockRef, {
                                current_stock: increment(qtyChange),
                                updatedAt: serverTimestamp()
                            }, { merge: true });
                        }
                    }
                }

                // Create Transaction
                const newTransRef = doc(collection(db, transCollName));
                batch.set(newTransRef, {
                    sheet_id: sheetId,
                    date: po.date,

                    // Core Fields matching Inventory.tsx
                    product_id: item.product_id,
                    product_name: item.product_description || item.manual_product_name || '',
                    category_name: categoryName,
                    supplier_name: po.supplier_name,
                    uom: uom,

                    // FG Specific Fields (Populate to match Inventory columns)
                    manual_supplier_name: po.supplier_name, // Customer Name
                    customer_po_no: po.po_no || po.linked_po_id || '', // PO No
                    manual_category_name: categoryName, // Category
                    manual_product_name: item.product_description || item.manual_product_name || '', // Item Name
                    item_code: item.item_code || '', // Persist item code

                    quantity: section === 'finished_goods' ? -Math.abs(Number(item.quantity)) : Number(item.quantity), // Save NEGATIVE for FG
                    rate: Number(item.rate),
                    length: Number(item.length || 0),
                    width: Number(item.width || 0),
                    gsm: Number(item.gsm || 0),
                    amount: item.line_total || 0, // Ensure amount is saved
                    total_amount: item.line_total || 0,
                    calculated_kgs: item.calculated_kgs || 0,

                    qty_per_box: Number(item.qty_per_box || 0),
                    no_of_boxes: Number(item.no_of_boxes || 0),

                    // Metadata
                    type: section === 'finished_goods' ? 'Sale' : 'Purchase',
                    transaction_type: section === 'finished_goods' ? 'Delivery Note' : 'Purchased', // CHANGED: Correct type for FG
                    section: section,
                    po_id: po.id,
                    po_no: po.po_no || po.linked_po_id || '', // ADDED: Ensure PO Number is saved for Dashboard
                    grn_no: section === 'finished_goods' ? (po.order_no || po.id) : (po.grn_no || ''), // FIX: Use Order No for FG, GRN No for RM
                    warehouse_id: po.warehouse_id || null, // ADDED
                    warehouse_name: po.warehouse_name || null, // ADDED
                    createdAt: serverTimestamp()
                });

                // Update Warehouse Stock (RM Only)
                if (section === 'raw_material' && po.warehouse_id && item.product_id) {
                    const whStockRef = doc(db, prodCollName, item.product_id, 'warehouse_stock', po.warehouse_id);
                    const qtyChange = Number(item.quantity);
                    batch.set(whStockRef, {
                        current_stock: increment(qtyChange),
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                }
            }

            // 3. Mark PO as Synced
            const poRef = doc(db, poCollName, po.id);
            batch.update(poRef, { is_synced: 1, status: section === 'finished_goods' ? 'Delivered' : 'Received' });

            await batch.commit();
            setSyncResult({
                isOpen: true,
                title: 'Success',
                message: `Inventory ${existingTransSnap.empty ? 'added' : 'updated'} successfully!`,
                type: 'success'
            })

        } catch (error) {
            console.error('Failed to sync', error);
            setSyncResult({
                isOpen: true,
                title: 'Error',
                message: 'Failed to sync inventory. See console.',
                type: 'error'
            })
        } finally {
            setIsLoading(false);
            setConfirmation({ isOpen: false, po: null, action: 'inventory' });
        }
    }

    // --- Export Function (.xlsx) - FLATTENED ---
    const handleExport = useCallback(() => {
        if (!gridApi) return

        const rowData: any[] = []

        // Iterate through filtered/sorted nodes
        gridApi.forEachNodeAfterFilterAndSort((node: any) => {
            const data = node.data;
            const items = data.items || [];

            if (items.length > 0) {
                // Create a row for each item
                items.forEach((item: any, idx: number) => {
                    const row: any = {
                        'Date': formatDate({ value: data.date }),
                        'Order No': data.order_no || (data.id ? (data.id.startsWith('PO-') || data.id.startsWith('DO-') ? data.id : `${section === 'finished_goods' ? 'DO' : 'PO'}-${data.id}`) : ''),
                        'Reference No': data.grn_no || '-', // GRN for RM, Order No for FG usually
                        'Vendor/Supplier': data.supplier_name || '',
                        'Product Name': item.product_description || item.manual_product_name || 'Unknown Item',
                        'Quantity': Number(item.quantity || 0),
                        'Rate': Number(item.rate || 0),
                        'Subtotal': Number((item.quantity || 0) * (item.rate || 0)),
                        'Freight': idx === 0 ? Number(data.freight_amount || 0) : '',
                        'Total Tax': idx === 0 ? Number(data.tax_amount || 0) : '', // Parent level tax - Only on first row
                        'Grand Total': idx === 0 ? Number(data.grand_total || 0) : '', // Parent level total - Only on first row
                        'Created By': data.created_by || ''
                    };

                    // Section Specific Fields
                    if (section === 'finished_goods') {
                        row['Boxes'] = Number(item.no_of_boxes || 0);
                        row['Qty/Box'] = Number(item.qty_per_box || 0);
                        // Hide RM specific
                        delete row['Reference No']; // Loop back if needed, but usually we just want a clean sheet
                        row['Buyer'] = row['Vendor/Supplier'];
                        delete row['Vendor/Supplier'];
                    } else {
                        // RM Specific
                        row['GRN No'] = data.grn_no || '-';
                        delete row['Reference No'];
                    }

                    rowData.push(row);
                });
            } else {
                // Fallback for PO with no items (shouldn't happen but good for safety)
                const row: any = {
                    'Date': formatDate({ value: data.date }),
                    'Order No': data.order_no,
                    'Vendor/Supplier': data.supplier_name,
                    'Product Name': 'No Items',
                    'Quantity': 0,
                    'Rate': 0,
                    'Grand Total': Number(data.grand_total || 0),
                    'Created By': data.created_by
                };
                if (section === 'finished_goods') {
                    row['Buyer'] = row['Vendor/Supplier'];
                    delete row['Vendor/Supplier'];
                } else {
                    row['GRN No'] = data.grn_no || '-';
                }
                rowData.push(row);
            }
        })

        const worksheet = XLSX.utils.json_to_sheet(rowData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "PurchaseOrders");

        XLSX.writeFile(workbook, `PurchaseOrders_${section}_${new Date().toISOString().split('T')[0]}.xlsx`);

    }, [gridApi, section])

    // --- Import Function (.csv or .xlsx) ---
    // Updated to use the new Custom ID generation (PO-XXX)
    const handleImportExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        setIsLoading(true)
        const reader = new FileReader()
        const POCollection = section === 'finished_goods' ? 'fg_delivery_orders' : 'rm_purchase_orders';

        reader.readAsArrayBuffer(file)

        reader.onload = async (e) => {
            const data = e.target?.result
            if (!data) {
                setIsLoading(false); return;
            }

            try {
                // 1. Read the workbook
                const workbook = XLSX.read(data, { type: 'array' })
                const sheetName = workbook.SheetNames[0]
                const worksheet = workbook.Sheets[sheetName]
                const jsonData = XLSX.utils.sheet_to_json(worksheet)

                // 2. Process and Save
                const batch = writeBatch(db);
                let count = 0;

                for (const row of jsonData as any[]) {
                    // Generate Custom Short ID (e.g., PO-A1B)
                    const customId = await generatePOId(section); // Pass section

                    const newPoRef = doc(db, POCollection, customId);

                    // Construct PO Object
                    const poData = {
                        ...row,
                        id: customId,
                        order_no: customId, // Ensure displayed order_no matches doc ID
                        type: section,
                        createdAt: serverTimestamp(),
                        status: 'Pending',
                        is_synced: 0
                    };

                    batch.set(newPoRef, poData);
                    count++;
                }

                await batch.commit();

                console.log(`Imported ${count} POs with Custom IDs`)
                alert(`Successfully imported ${count} orders.`)

            } catch (error) {
                console.error("Error reading file:", error)
                alert("Failed to parse or save file.")
            } finally {
                event.target.value = ''
                setIsLoading(false)
            }
        }
    }

    // --- Helper to Fetch Supplier Info for PDFs ---
    const fetchSupplierForPdf = async (basePo: any) => {
        let poForPdf = { ...basePo };

        // Fetch Supplier Details
        if (poForPdf.supplier_name) {
            const collectionName = section === 'finished_goods' ? 'fg_buyers' : 'rm_suppliers';
            const suppQuery = query(collection(db, collectionName), where('name', '==', poForPdf.supplier_name));
            const suppSnap = await getDocs(suppQuery);
            if (!suppSnap.empty) {
                const suppData = suppSnap.docs[0].data();
                poForPdf.supplier_address = suppData.address || '';
                poForPdf.supplier_phone = suppData.telephone || '';
            }
        }

        // Fetch missing item_code for older transactions
        if (poForPdf.items && poForPdf.items.length > 0) {
            const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
            const updatedItems = [];
            for (let item of poForPdf.items) {
                let currentItem = { ...item };
                if (!currentItem.item_code && currentItem.product_id) {
                    try {
                        const prodRef = doc(db, prodCollName, currentItem.product_id);
                        const prodSnap = await getDoc(prodRef);
                        if (prodSnap.exists()) {
                            currentItem.item_code = prodSnap.data().item_code || '';
                        }
                    } catch (e) {
                        console.error("Failed to fetch item code", e);
                    }
                }
                updatedItems.push(currentItem);
            }
            poForPdf.items = updatedItems;
        }

        return poForPdf;
    }

    // --- Custom Print Handler ---
    // Uses an iframe to print the PDF blob directly, avoiding the "Open in App" dialog
    const handleDirectPrint = async (docType: string) => {
        if (!showPdfOptions.po) return;

        setIsLoading(true);
        try {
            // Fetch supplier details for PDF Address/Phone
            const poForPdf = await fetchSupplierForPdf(showPdfOptions.po);

            // NOTE: If you receive ERR_BLOCKED_BY_CSP, you must update your index.html
            // Content-Security-Policy to allow 'blob:' scheme.

            let pdfOutput: any;

            if (docType === 'DELIVERY NOTE') {
                pdfOutput = await generateDeliveryNote(poForPdf, companySettings, 'datauristring' as any, user);
            } else {
                pdfOutput = await generatePOPdf(poForPdf, companySettings, 'datauristring' as any, docType);
            }

            if (typeof pdfOutput === 'string' && pdfOutput.startsWith('data:application/pdf')) {
                const success = await window.electron.ipcRenderer.invoke('print-pdf', pdfOutput);
                if (!success) {
                    alert("Print failed or was cancelled.");
                }
            } else {
                console.warn("PDF Generator did not return a valid data URI format.");
                alert("Failed to prepare document format for printing.");
            }
        } catch (e) {
            console.error("Print Error:", e);
            alert("Failed to prepare document for printing.");
        } finally {
            setIsLoading(false);
            setShowPdfOptions({ ...showPdfOptions, show: false });
        }
    };

    // --- Grouping Logic for "Wrap Up" ---
    const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
    const [selectedYear, setSelectedYear] = useState<number | null>(null);
    const [showSidebar, setShowSidebar] = useState(true);

    const groupedPOs = useMemo(() => {
        const groups: { [year: number]: { [month: number]: any[] } } = {};
        pos.forEach(po => {
            if (!po.date) return;
            const d = new Date(po.date);
            const y = d.getFullYear();
            const m = d.getMonth() + 1;

            if (!groups[y]) groups[y] = {};
            if (!groups[y][m]) groups[y][m] = [];
            groups[y][m].push(po);
        });
        return groups;
    }, [pos]);

    // Set Default Selection (Latest) if nothing selected
    useEffect(() => {
        if ((!selectedYear || !selectedMonth) && pos.length > 0) {
            // Find latest year
            const years = Object.keys(groupedPOs).map(Number).sort((a, b) => b - a);
            if (years.length > 0) {
                const latestYear = years[0];
                const months = Object.keys(groupedPOs[latestYear]).map(Number).sort((a, b) => b - a);
                if (months.length > 0) {
                    setSelectedYear(latestYear);
                    setSelectedMonth(months[0]);
                }
            }
        }
    }, [pos, groupedPOs, selectedYear, selectedMonth]);

    const filteredPOs = useMemo(() => {
        if (!selectedYear || !selectedMonth) return [];
        return groupedPOs[selectedYear]?.[selectedMonth] || [];
    }, [groupedPOs, selectedYear, selectedMonth]);

    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const columnDefs = useMemo(() => [
        { field: 'date', headerName: 'Date', width: 110, valueFormatter: formatDate },
        {
            field: 'order_no',
            headerName: 'Order No',
            width: 120,
            valueGetter: (params: any) => {
                const orderNo = params.data.order_no;
                const id = params.data.id || '';
                if (orderNo) return orderNo;
                if (id && (id.startsWith('PO-') || id.startsWith('DO-'))) return id;
                return `${section === 'finished_goods' ? 'DO' : 'PO'}-${id}`;
            }
        },
        {
            field: 'grn_no',
            headerName: 'GRN No',
            width: 120,
            hide: section === 'finished_goods',
            valueFormatter: (params: any) => params.value || '-'
        },
        {
            field: 'ogp_no',
            headerName: 'OGP No',
            width: 100,
            hide: section !== 'finished_goods',
            valueFormatter: (params: any) => params.value || '-'
        },
        { field: 'supplier_name', headerName: section === 'finished_goods' ? 'Buyer' : 'Vendor/Supplier', width: 180 },
        {
            headerName: 'Product Name',
            width: 250,
            autoHeight: true,
            valueGetter: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return params.data.items.map((i: any) => i.product_description || i.manual_product_name || 'Unknown Item').join('\n');
                }
                return '';
            },
            cellRenderer: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return (
                        <div className="py-1">
                            {params.data.items.map((i: any, idx: number) => (
                                <div key={idx} className="text-xs leading-tight mb-1 border-b border-gray-100 last:border-0 pb-1 h-6 flex items-center">
                                    <span className="font-bold">{i.product_description || i.manual_product_name || 'Unknown Item'}</span>
                                    {i.length ? <span className="text-gray-500 ml-1 text-[10px]">[ {i.length}x{i.width} {i.gsm}g ]</span> : ''}
                                </div>
                            ))}
                        </div>
                    )
                }
                return ''
            }
        },
        // Restored Column: Boxes
        {
            colId: 'boxes',
            headerName: 'Boxes',
            width: 80,
            hide: section !== 'finished_goods',
            autoHeight: true,
            valueGetter: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return params.data.items.map((i: any) => i.no_of_boxes || '-').join('\n');
                }
                return '';
            },
            cellRenderer: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return (
                        <div className="py-1">
                            {params.data.items.map((i: any, idx: number) => (
                                <div key={idx} className="text-xs leading-tight mb-1 border-b border-gray-100 last:border-0 pb-1 h-6 flex items-center justify-end">
                                    {i.no_of_boxes || '-'}
                                </div>
                            ))}
                        </div>
                    )
                }
                return ''
            }
        },
        // Restored Column: Qty/Box
        {
            colId: 'qty_per_box',
            headerName: 'Qty/Box',
            width: 80,
            hide: section !== 'finished_goods',
            autoHeight: true,
            valueGetter: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return params.data.items.map((i: any) => i.qty_per_box || '-').join('\n');
                }
                return '';
            },
            cellRenderer: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return (
                        <div className="py-1">
                            {params.data.items.map((i: any, idx: number) => (
                                <div key={idx} className="text-xs leading-tight mb-1 border-b border-gray-100 last:border-0 pb-1 h-6 flex items-center justify-end">
                                    {i.qty_per_box || '-'}
                                </div>
                            ))}
                        </div>
                    )
                }
                return ''
            }
        },
        {
            colId: 'quantity',
            headerName: 'Quantity',
            width: 100,
            autoHeight: true,
            valueGetter: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return params.data.items.map((i: any) => formatNumber(i.quantity)).join('\n');
                }
                return '';
            },
            cellRenderer: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return (
                        <div className="py-1">
                            {params.data.items.map((i: any, idx: number) => (
                                <div key={idx} className="text-xs leading-tight mb-1 border-b border-gray-100 last:border-0 pb-1 h-6 flex items-center justify-end">
                                    {formatNumber(i.quantity)}
                                </div>
                            ))}
                        </div>
                    )
                }
                return ''
            }
        },
        // KG Column (RM Only — Paper & Board category)
        {
            colId: 'calculated_kgs',
            headerName: 'KG',
            width: 100,
            hide: section === 'finished_goods',
            autoHeight: true,
            valueGetter: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return params.data.items.map((i: any) =>
                        i.calculated_kgs ? formatNumber(i.calculated_kgs) : '-'
                    ).join('\n');
                }
                return '';
            },
            cellRenderer: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return (
                        <div className="py-1">
                            {params.data.items.map((i: any, idx: number) => (
                                <div key={idx} className="text-xs leading-tight mb-1 border-b border-gray-100 last:border-0 pb-1 h-6 flex items-center justify-end">
                                    {i.calculated_kgs ? formatNumber(i.calculated_kgs) : '-'}
                                </div>
                            ))}
                        </div>
                    )
                }
                return ''
            }
        },

        {
            colId: 'rate',
            headerName: 'Rate',
            width: 100,
            hide: section === 'finished_goods',
            autoHeight: true,
            valueGetter: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return params.data.items.map((i: any) => formatCurrency(i.rate)).join('\n');
                }
                return '';
            },
            cellRenderer: (params: any) => {
                if (params.data.items && params.data.items.length > 0) {
                    return (
                        <div className="py-1">
                            {params.data.items.map((i: any, idx: number) => (
                                <div key={idx} className="text-xs leading-tight mb-1 border-b border-gray-100 last:border-0 pb-1 h-6 flex items-center justify-end">
                                    {formatCurrency(i.rate)}
                                </div>
                            ))}
                        </div>
                    )
                }
                return ''
            }
        },
        // Subtotal (before tax)
        {
            colId: 'subtotal',
            headerName: 'Subtotal',
            width: 100,
            hide: section === 'finished_goods',
            valueGetter: (params: any) => {
                const grandTotal = params.data.grand_total || 0
                const taxAmount = params.data.tax_amount || 0
                const freightAmount = params.data.freight_amount || 0
                return grandTotal - taxAmount - freightAmount
            },
            valueFormatter: (params: any) => formatCurrency(params.value)
        },
        // Freight Amount
        {
            field: 'freight_amount',
            headerName: 'Freight',
            width: 100,
            hide: section === 'finished_goods',
            valueFormatter: (params: any) => formatCurrency(params.value)
        },
        // Total with Tax
        {
            field: 'grand_total',
            headerName: 'Total with Tax',
            width: 120,
            hide: section === 'finished_goods',
            valueFormatter: (params: any) => formatCurrency(params.value)
        },
        // Tax Rate
        {
            colId: 'tax',
            headerName: 'Tax',
            width: 80,
            hide: section === 'finished_goods',
            valueGetter: (params: any) => params.data.tax_amount ? `${params.data.tax_rate}%` : '-'
        },
        { field: 'created_by', headerName: 'Created By', width: 120 },
        {
            colId: 'actions',
            headerName: 'Actions',
            width: 200,
            cellRenderer: (params: any) => {
                const isSynced = params.data.is_synced === 1;

                // RBAC: Edit Button
                // RM: Admin OR PurchaseOfficer
                // FG: Admin OR DeliveryOfficer
                const canEdit = user?.role === 'admin' ||
                    (section === 'raw_material' && user?.role === 'po_officer') ||
                    (section === 'finished_goods' && user?.role === 'delivery_officer');

                return (
                    <div className="flex gap-2 items-center justify-center h-full">
                        {canEdit && (
                            <>
                                <button
                                    onClick={() => onEdit && onEdit(params.data)}
                                    className="hover:opacity-80 transition-opacity"
                                    title="Edit PO"
                                >
                                    <img src={editIcon} alt="Edit" className="w-5 h-5" />
                                </button>
                                <button
                                    onClick={() => requestDelete(params.data)}
                                    className="hover:opacity-80 transition-opacity"
                                    title="Delete PO"
                                >
                                    <img src={deleteIcon} alt="Delete" className="w-5 h-5" />
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => setShowPdfOptions({ show: true, po: params.data, mode: 'save' })}
                            className="hover:opacity-80 transition-opacity"
                            title="Save PDF"
                        >
                            <img src={saveIcon} alt="Save" className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setShowPdfOptions({ show: true, po: params.data, mode: 'print' })}
                            className="hover:opacity-80 transition-opacity"
                            title="Print PDF"
                        >
                            <img src={printIcon} alt="Print" className="w-5 h-5" />
                        </button>
                        <div className="w-px h-6 bg-gray-300 mx-1"></div>
                        {section === 'finished_goods' && params.data.status !== 'Draft' && (
                            <button
                                onClick={() => setDnStatusModal({ isOpen: true, grnNo: params.data.order_no })}
                                className="hover:opacity-80 transition-opacity text-purple-600 mr-2"
                                title="Update Delivery Status"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                            </button>
                        )}
                        <button
                            onClick={() => requestAddToInventory(params.data)}
                            className={`hover:opacity-80 transition-opacity ${isSynced ? 'text-green-600' : 'text-gray-600'}`}
                            title={isSynced ? "Update Inventory (Re-Sync)" : "Add to Inventory"}
                        >
                            <img src={inventoryIcon} alt="Inventory" className={`w-5 h-5 ${isSynced ? 'sepia hue-rotate-90' : ''}`} />
                        </button>
                    </div>
                )
            }
        }
    ], [section, onEdit, requestAddToInventory, user])

    return (
        <div className="flex h-[calc(100vh-100px)] bg-gray-100 overflow-hidden text-gray-800 relative">
            {/* Sidebar */}
            {showSidebar && (
                <div className="w-64 bg-white border-r flex flex-col flex-shrink-0 shadow-sm animate-in slide-in-from-left duration-200">
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-gray-700">{section === 'finished_goods' ? 'DN History' : 'PO History'}</h3>
                        <button onClick={() => setShowSidebar(false)} className="text-gray-400 hover:text-gray-600">✕</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                        {Object.keys(groupedPOs).length === 0 ? (
                            <div className="p-4 text-sm text-gray-400 italic">No orders found.</div>
                        ) : Object.keys(groupedPOs).sort((a, b) => Number(b) - Number(a)).map(year => (
                            <div key={year} className="mb-4">
                                <div className="font-bold text-sm text-gray-500 px-2 mb-1">{year}</div>
                                {Object.keys(groupedPOs[Number(year)]).sort((a, b) => Number(b) - Number(a)).map(month => (
                                    <button
                                        key={`${year}-${month}`}
                                        onClick={() => { setSelectedYear(Number(year)); setSelectedMonth(Number(month)); }}
                                        className={`w-full text-left px-4 py-2 rounded text-sm mb-1 transition-colors flex justify-between items-center ${selectedYear === Number(year) && selectedMonth === Number(month)
                                            ? 'bg-blue-600 text-white font-medium shadow-sm'
                                            : 'hover:bg-gray-100 text-gray-600'
                                            }`}
                                    >
                                        <span>{monthNames[Number(month) - 1]}</span>
                                        <span className={`text-xs ${selectedYear === Number(year) && selectedMonth === Number(month) ? 'text-blue-200' : 'text-gray-400'}`}>
                                            {groupedPOs[Number(year)][Number(month)].length}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {isLoading && <LoadingOverlay />}

                {renderError && (
                    <div className="mb-4 p-3 bg-red-100 border border-red-200 text-sm text-red-700 rounded-lg shadow-sm flex items-center gap-2">
                        <span className="font-bold">⚠️ DB ERROR:</span> {renderError}
                    </div>
                )}

                <div className="p-4 bg-white border-b flex justify-between items-center shadow-sm flex-shrink-0 relative">
                    <div className="flex items-center gap-4">
                        {!showSidebar && <button onClick={() => setShowSidebar(true)} className="bg-gray-100 p-2 rounded hover:bg-gray-200 transition-colors">☰</button>}
                        <h2 className="text-xl font-bold text-gray-800">
                            {section === 'finished_goods' ? 'DELIVERY NOTES' : 'PURCHASE ORDERS'}
                            {selectedYear && selectedMonth && <span className="ml-2 text-gray-500 font-normal text-lg">({monthNames[selectedMonth - 1]} {selectedYear})</span>}
                        </h2>
                    </div>
                    <div className="flex items-center gap-3 relative">
                        {/* Export Button */}
                        <button
                            onClick={handleExport}
                            className="px-4 py-2 rounded transition shadow-sm font-bold border bg-white text-green-700 hover:bg-green-50 border-green-200 flex items-center gap-2"
                            title="Export to Excel (.xlsx)"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            Export Excel
                        </button>

                        {/* Column Manager Button */}
                        <div className="relative">
                            <button
                                onClick={() => setShowColManager(!showColManager)}
                                className={`px-4 py-2 rounded transition shadow-sm font-bold border flex items-center gap-2 ${showColManager ? 'bg-gray-200 text-gray-800' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                                title="Manage Columns"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v18h-6M10 17l5-5-5-5M3 13v6M3 5v6" /></svg>
                                Columns
                            </button>
                            {showColManager && gridApi && (
                                <ColumnManager api={gridApi} onClose={() => setShowColManager(false)} gridId={`purchase-orders-${section}`} />
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 bg-gray-50 overflow-hidden p-4">
                    <div className="ag-theme-alpine h-full w-full shadow-lg rounded-xl overflow-hidden border border-gray-200">
                        <AgGridReact
                            enableCellTextSelection={true}
                            key={section}
                            getRowId={(params) => params.data.id}
                            onGridReady={onGridReady}
                            rowData={filteredPOs} // Use Filtered Data
                            columnDefs={columnDefs}
                            defaultColDef={{ sortable: true, filter: true, resizable: true }}
                            rowHeight={80}
                            icons={{
                                sortAscending: `<img src="${sortIcon}" style="width: 14px; height: 14px;"/>`,
                                sortDescending: `<img src="${sortIcon}" style="width: 14px; height: 14px; transform: rotate(180deg);"/>`,
                                sortUnSort: `<img src="${sortIcon}" style="width: 14px; height: 14px; opacity: 0.5;"/>`,
                                menu: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`,
                                filter: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`
                            }}
                            {...gridStateHandlers}
                            overlayNoRowsTemplate={selectedMonth ? "No orders found in this month." : "Please select a month..."}
                        />
                    </div>
                </div>

                {/* PDF Options Modal */}
                {showPdfOptions.show && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white p-6 rounded-2xl shadow-2xl w-96 animate-in zoom-in-95 duration-200">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">
                                {showPdfOptions.mode === 'print' ? 'Select to Print' : 'Select Document Type'}
                            </h3>
                            <div className="flex flex-col gap-3">
                                {section === 'finished_goods' ? (
                                    <button
                                        onClick={async () => {
                                            if (showPdfOptions.mode === 'print') {
                                                handleDirectPrint('DELIVERY NOTE')
                                            } else {
                                                setIsLoading(true);
                                                try {
                                                    const poForPdf = await fetchSupplierForPdf(showPdfOptions.po);
                                                    const module = await import('../utils/pdfGenerator');
                                                    module.generateDeliveryNote(poForPdf, companySettings, showPdfOptions.mode, user);
                                                    setIsLoading(false);
                                                    setShowPdfOptions({ show: false, po: null, mode: 'save' });
                                                } catch (e) {
                                                    setIsLoading(false);
                                                    setShowPdfOptions({ show: false, po: null, mode: 'save' });
                                                }
                                            }
                                        }}
                                        className="bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition shadow-md"
                                    >
                                        Delivery Note
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={async () => {
                                                if (showPdfOptions.mode === 'print') {
                                                    handleDirectPrint('PURCHASE ORDER')
                                                } else {
                                                    setIsLoading(true);
                                                    try {
                                                        const poForPdf = await fetchSupplierForPdf(showPdfOptions.po);
                                                        generatePOPdf(poForPdf, companySettings, showPdfOptions.mode, 'PURCHASE ORDER');
                                                    } finally {
                                                        setIsLoading(false);
                                                        setShowPdfOptions({ show: false, po: null, mode: 'save' });
                                                    }
                                                }
                                            }}
                                            className="bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition shadow-md"
                                        >
                                            Purchase Order
                                        </button>
                                        <button
                                            onClick={async () => {
                                                if (showPdfOptions.mode === 'print') {
                                                    handleDirectPrint('PURCHASE INVOICE')
                                                } else {
                                                    setIsLoading(true);
                                                    try {
                                                        const poForPdf = await fetchSupplierForPdf(showPdfOptions.po);
                                                        generatePOPdf(poForPdf, companySettings, showPdfOptions.mode, 'PURCHASE INVOICE');
                                                    } finally {
                                                        setIsLoading(false);
                                                        setShowPdfOptions({ show: false, po: null, mode: 'save' });
                                                    }
                                                }
                                            }}
                                            className="bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition shadow-md"
                                        >
                                            Purchase Invoice
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => setShowPdfOptions({ show: false, po: null, mode: 'save' })}
                                    className="mt-2 text-gray-500 hover:text-gray-700 font-bold py-2"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Inventory Sync Confirmation Modal */}
                {/* Inventory Sync / Delete Confirmation Modal */}
                <ConfirmationModal
                    isOpen={confirmation.isOpen}
                    title={confirmation.action === 'delete' ? 'Delete Order?' : 'Add to Inventory?'}
                    message={confirmation.action === 'delete'
                        ? `Are you sure you want to PERMANENTLY DELETE ${section === 'finished_goods' ? 'DO' : 'PO'}-${confirmation.po?.id || ''}? This will also remove associated inventory.`
                        : `Are you sure you want to add items from ${section === 'finished_goods' ? 'DO' : 'PO'}-${confirmation.po?.id || ''} to Inventory?`
                    }
                    onConfirm={confirmation.action === 'delete' ? executeDelete : executeAddToInventory}
                    onCancel={() => setConfirmation({ isOpen: false, po: null, action: 'inventory' })}
                    confirmText={confirmation.action === 'delete' ? 'Delete' : 'Add to Inventory'}
                    isDangerous={confirmation.action === 'delete'}
                />

                {/* Update DN Status Modal */}
                <UpdateDNStatusModal
                    isOpen={dnStatusModal.isOpen}
                    onClose={() => setDnStatusModal({ isOpen: false, grnNo: '' })}
                    grnNo={dnStatusModal.grnNo}
                />
            </div>
        </div>
    )
}

export default PurchaseOrders