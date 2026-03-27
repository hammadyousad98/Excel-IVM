import React, { useMemo, useState, useEffect, useCallback, forwardRef, useImperativeHandle, useRef } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { ColDef, ICellEditorParams } from 'ag-grid-community'
import * as XLSX from 'xlsx'
import editIcon from '../assets/edit.png' // Keeping if needed, though mostly direct edit
import deleteIcon from '../assets/delete.png'
import filterIcon from '../assets/filter.png'
import sortIcon from '../assets/sortingArrows.png'
import { ConfirmationModal } from './ConfirmationModal'
import { AddEntryModal } from './AddEntryModal'
import { BulkAddEntryModal } from './BulkAddEntryModal' // Import Bulk Modal
import { TransferModal } from './TransferModal'
import { db } from '../firebase'
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    getDoc,
    onSnapshot,
    query,
    where,
    orderBy,
    serverTimestamp,
    getDocs,
    increment,
    writeBatch
} from 'firebase/firestore'
import { useGridState } from '../hooks/useGridState'
import { useAuth } from '../context/AuthContext'
import { saveUserLayout, getUserLayout, resetUserLayout } from '../utils/userLayoutService'

// Types
export interface InventorySheet {
    id: string;
    month: number;
    year: number;
    section: string;
    isLocked?: boolean;
}

// Loading Component
const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[200] backdrop-blur-sm">
        <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
            <div className="text-gray-700 font-bold text-lg">Processing...</div>
        </div>
    </div>
)

// --- Searchable Select Editor ---
// Uses native <datalist> to allow typing + selecting
const SearchableSelectCellEditor = forwardRef((props: ICellEditorParams & { values: string[] }, ref) => {
    const [value, setValue] = useState(props.value || '');
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({
        getValue: () => value,
        isPopup: () => false
    }));

    useEffect(() => {
        // Focus the input when editing starts
        setTimeout(() => inputRef.current?.focus(), 10);
    }, []);

    const filtered = (props.values || []).filter(v =>
        v.toLowerCase().includes(value.toString().toLowerCase())
    );

    const handleKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setFocusedIndex(prev => (prev < filtered.length - 1 ? prev + 1 : prev));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setFocusedIndex(prev => (prev > 0 ? prev - 1 : prev));
                break;
            case 'Enter':
                if (focusedIndex >= 0 && filtered[focusedIndex]) {
                    setValue(filtered[focusedIndex]);
                }
                break;
        }
    };

    // Unique ID for datalist to avoid collisions
    const listId = useMemo(() => `datalist-${Math.random().toString(36).substr(2, 9)}`, []);

    return (
        <div className="w-full h-full bg-white relative">
            <input
                ref={inputRef}
                list={listId}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full h-full border-none outline-none px-2 text-sm"
                placeholder="Type to search..."
            />
            <datalist id={listId}>
                {props.values && props.values.map((v: string, i: number) => (
                    <option key={i} value={v} />
                ))}
            </datalist>
        </div>
    );
});

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
                            <button
                                onClick={() => togglePin(col.id, col.pinned)}
                                className={`p-1 rounded transition-colors ${col.pinned === 'left' ? 'bg-blue-100 text-blue-600' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                                title={col.pinned === 'left' ? "Unpin" : "Pin Left"}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
                            </button>
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

// Helper Functions
const richSelectParams = (values: string[]) => ({ values })

const formatNumber = (params: any) => {
    const value = params.value
    if (value === undefined || value === null) return ''
    const absValue = Math.abs(value)
    // Ensure comma separation with maximum 2 fraction digits
    const formatted = absValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    return value < 0 ? `(${formatted})` : formatted
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

const numericCellClassRules = {
    'bg-red-200 text-red-900 font-bold': (params: any) => typeof params.value === 'number' && params.value < 0
}

const formatCurrency = (params: any) => {
    const value = params.value
    if (value === undefined || value === null) return ''
    const absValue = Math.abs(value)
    const formatted = absValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return value < 0 ? `(${formatted})` : formatted
}

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

// --- Update DN Status Modal (FG Only) ---
// MOVED TO: ./UpdateDNStatusModal.tsx


export const Inventory: React.FC<{ section?: string }> = ({ section = 'raw_material' }) => {
    // Replaced useSheets hook with direct state/effects
    const [sheets, setSheets] = useState<InventorySheet[]>([])
    const [sheetsLoading, setSheetsLoading] = useState(true)

    const [selectedSheet, setSelectedSheet] = useState<InventorySheet | null>(null)
    const [transactions, setTransactions] = useState<any[]>([])
    const [loading, setLoading] = useState(false) // Data loading
    const [isProcessing, setIsProcessing] = useState(false) // Action loading (save/delete)
    const [renderError, setRenderError] = useState<string | null>(null)
    const [status, setStatus] = useState<string | null>(null)
    const [showSidebar, setShowSidebar] = useState(true)
    // Ag-Grid API State
    const [gridApi, setGridApi] = useState<any>(null)
    const [showColManager, setShowColManager] = useState(false)

    // State for Delete Confirmation Modal
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ isOpen: boolean; rowId: string | null }>({
        isOpen: false,
        rowId: null
    })

    const [addEntryModal, setAddEntryModal] = useState<{ isOpen: boolean; data?: any }>({
        isOpen: false,
        data: undefined
    })

    const [showBulkAddModal, setShowBulkAddModal] = useState(false) // State for Bulk Modal

    const [transferModal, setTransferModal] = useState<{ isOpen: boolean; data?: any }>({ isOpen: false });
    const [warehouses, setWarehouses] = useState<any[]>([]);

    const [stockAlert, setStockAlert] = useState<{ isOpen: boolean; title: string; message: string }>({
        isOpen: false,
        title: '',
        message: ''
    })

    const [deleteSheetConfirmation, setDeleteSheetConfirmation] = useState<{
        isOpen: boolean;
        sheet: InventorySheet | null;
    }>({
        isOpen: false,
        sheet: null
    })

    const [options, setOptions] = useState<{
        categories: string[],
        suppliers: string[],
        uoms: string[],
        types: string[],
        products: string[]
    }>({
        categories: [],
        suppliers: [],
        uoms: ['Kg', 'Sheet', 'Pc', 'Pcs', 'BTL'],
        types: section === 'finished_goods'
            ? ['Sales Order', 'Manufactured Product', 'Delivery Note', 'Opening', 'Return']
            : ['Issued', 'Opening', 'Purchase', 'Return To Store'],
        products: []
    })

    const [productsList, setProductsList] = useState<any[]>([])
    const [quickFilterText, setQuickFilterText] = useState(() => {
        return localStorage.getItem(`inventory_search_${section}`) || ''
    })

    // Grid Setup
    const gridStateHandlers = useGridState(`inventory-${section}`, gridApi)

    const { user } = useAuth()
    const isAdmin = user?.role === 'admin' || (section === 'finished_goods' && user?.role === 'delivery_officer')

    // --- Load Warehouses ---
    useEffect(() => {
        const fetchW = async () => {
            if (section === 'raw_material') {
                const snap = await getDocs(collection(db, 'warehouses'));
                let warehouseData: any[] = [];
                if (!snap.empty) {
                    warehouseData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                } else {
                    // Seed only if completely empty
                    const w1 = await addDoc(collection(db, 'warehouses'), { name: 'Warehouse 1' });
                    const w2 = await addDoc(collection(db, 'warehouses'), { name: 'Warehouse 2' });
                    warehouseData = [
                        { id: w1.id, name: 'Warehouse 1' },
                        { id: w2.id, name: 'Warehouse 2' }
                    ];
                }

                // Deduplicate by name to handle potential duplicate records in Firestore
                const uniqueWarehouses = Array.from(
                    new Map(warehouseData.map((item: any) => [item.name, item])).values()
                );
                setWarehouses(uniqueWarehouses);
            }
        };
        fetchW();
    }, [section]);

    // --- 1. Fetch Sheets (Real-time) ---
    useEffect(() => {
        setSheetsLoading(true)
        const sheetCollName = section === 'finished_goods' ? 'fg_inventory_sheets' : 'rm_inventory_sheets';
        const q = collection(db, sheetCollName);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            console.log(`[Inventory] Sheets Snap: ${snapshot.docs.length} docs`);
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as InventorySheet[];

            // Sort Client-side to bypass Index requirement
            data.sort((a, b) => {
                if (b.year !== a.year) return b.year - a.year;
                return b.month - a.month;
            });

            setSheets(data);
            setSheetsLoading(false);
            setRenderError(null);
        }, (error) => {
            console.error("Error fetching sheets:", error);
            setRenderError("Sheets Fetch Error: " + error.message);
            setSheetsLoading(false);
        });

        return () => unsubscribe();
    }, [section]);

    // Sync search text when section changes
    useEffect(() => {
        setQuickFilterText(localStorage.getItem(`inventory_search_${section}`) || '');
    }, [section]);

    // --- 2. Select Default Sheet ---
    useEffect(() => {
        if (sheets.length > 0 && !selectedSheet) {
            const now = new Date()
            const current = sheets.find(s => s.month === now.getMonth() + 1 && s.year === now.getFullYear())
            setSelectedSheet(current || sheets[0])
        }
    }, [sheets, selectedSheet])

    // --- Sync Selected Sheet with Realtime Updates (e.g. Lock Status) ---
    useEffect(() => {
        if (selectedSheet) {
            const fresh = sheets.find(s => s.id === selectedSheet.id);
            if (fresh && (fresh.isLocked !== selectedSheet.isLocked)) {
                setSelectedSheet(fresh);
            }
        }
    }, [sheets]);

    // --- 3. Fetch Transactions (Real-time) ---
    useEffect(() => {
        let isSubscribed = true;
        if (!selectedSheet) {
            setTransactions([]);
            return;
        }

        setLoading(true);
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
        // Note: 'inventory_transactions' needs to be indexed by sheet_id
        const q = query(
            collection(db, transCollName),
            where('sheet_id', '==', selectedSheet.id)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!isSubscribed) return;
            console.log(`[Inventory] Trans Snap for ${selectedSheet.id}: ${snapshot.docs.length} docs`);
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data({ serverTimestamps: 'estimate' })
            }));

            // Re-sort locally to ensure estimated timestamps are placed correctly
            data.sort((a: any, b: any) => {
                const dateA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
                const dateB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
                return dateA - dateB; // asc
            });

            setTransactions(data);
            setLoading(false);
            setRenderError(null);
        }, (error) => {
            if (!isSubscribed) return;
            console.error("Error fetching transactions:", error);
            setRenderError("Transactions Fetch Error: " + error.message);
            setLoading(false);
        });

        return () => {
            isSubscribed = false;
            unsubscribe();
        };
    }, [selectedSheet, section]);

    // --- 4. Fetch Dropdown Options ---
    const fetchUniqueValues = useCallback(async () => {
        try {
            // Using getDocs for dropdowns to reduce active listeners,
            // but you could use onSnapshot if categories change often.
            const catCollName = section === 'finished_goods' ? 'fg_categories' : 'rm_categories';
            const supCollName = section === 'finished_goods' ? 'fg_buyers' : 'rm_suppliers';
            const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
            const uomCollName = section === 'finished_goods' ? 'fg_UOM' : 'rm_UOM';

            const [catsSnap, suppsSnap, prodsSnap, uomsSnap] = await Promise.all([
                getDocs(collection(db, catCollName)),
                getDocs(collection(db, supCollName)),
                getDocs(collection(db, prodCollName)),
                getDocs(collection(db, uomCollName))
            ]);

            const categories = catsSnap.docs.map(d => d.data().name);
            const suppliers = suppsSnap.docs.map(d => d.data().name);
            const products = prodsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            const uoms = uomsSnap.docs.map(d => d.data().name);

            setProductsList(products);
            setOptions(prev => ({
                ...prev,
                categories: Array.from(new Set([...prev.categories, ...categories])),
                suppliers: Array.from(new Set([...prev.suppliers, ...suppliers])),
                uoms: uoms.length > 0 ? uoms : (section === 'finished_goods' ? ['Pc', 'Set'] : ['Kg', 'Sheet', 'Pc', 'Pcs', 'BTL', 'Roll']),
                products: products.map((p: any) => p.description)
            }))
        } catch (e) {
            console.error('Failed to fetch options', e)
        }
    }, [section])

    useEffect(() => {
        console.log("[Dashboard] Initializing Dashboard...");
        fetchUniqueValues()
    }, [fetchUniqueValues])



    // --- Auto Sheet Resolver ---
    // Given an entry date string, finds or auto-creates a monthly sheet and returns its id + object.
    const resolveSheetForDate = async (dateStr: string): Promise<{ sheetId: string; sheetObj: InventorySheet }> => {
        const d = dateStr ? new Date(dateStr) : new Date();
        const month = d.getMonth() + 1;
        const year = d.getFullYear();
        const sheetCollName = section === 'finished_goods' ? 'fg_inventory_sheets' : 'rm_inventory_sheets';

        // 1. Fast path: check in-memory list
        const existing = sheets.find(s => s.month === month && s.year === year);
        if (existing) return { sheetId: existing.id, sheetObj: existing };

        // 2. Re-verify in Firestore in case local state is stale
        const sheetQuery = query(
            collection(db, sheetCollName),
            where('month', '==', month),
            where('year', '==', year),
            where('section', '==', section)
        );
        const sheetSnap = await getDocs(sheetQuery);
        if (!sheetSnap.empty) {
            const s = { id: sheetSnap.docs[0].id, ...sheetSnap.docs[0].data() } as InventorySheet;
            return { sheetId: s.id, sheetObj: s };
        }

        // 3. Auto-create a fresh sheet (no carry-forward)
        const newSheetRef = doc(collection(db, sheetCollName));
        const sheetData = { month, year, section, createdAt: serverTimestamp(), isLocked: false };
        const autoSheetBatch = writeBatch(db);
        autoSheetBatch.set(newSheetRef, sheetData);
        await autoSheetBatch.commit();
        console.log(`[AutoSheet] Created sheet for ${month}/${year} -> id: ${newSheetRef.id}`);
        const newSheet: InventorySheet = { id: newSheetRef.id, month, year, section, isLocked: false };
        setSelectedSheet(newSheet);
        return { sheetId: newSheetRef.id, sheetObj: newSheet };
    };

    // --- Add/Edit Entry Handler ---
    const handleSaveEntry = async (entryData: any) => {
        setIsProcessing(true);
        setStatus('Saving...');

        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';

        try {
            // ---- STEP 0: Resolve the target sheet from entry date ----
            const entryDate = entryData.date || new Date().toISOString().split('T')[0];
            const { sheetId: resolvedSheetId, sheetObj: resolvedSheet } = await resolveSheetForDate(entryDate);

            // Lock check
            if (resolvedSheet.isLocked) {
                setRenderError('This sheet is locked. You cannot add or edit entries.');
                setStatus('Error');
                return;
            }

            const batch = writeBatch(db);

            // 1. Prepare Data & Resolve Canonical Warehouse
            const isIssue = entryData.transaction_type === 'Issue';
            const finalQty = isIssue ? -Math.abs(Number(entryData.quantity)) : Math.abs(Number(entryData.quantity));

            let resolvedWarehouseId = entryData.warehouse_id;
            let resolvedWarehouseName = entryData.warehouse_name;

            if (section === 'raw_material' && (entryData.warehouse_id || entryData.warehouse_name)) {
                // If we have a name, find the canonical ID for that name from our current deduplicated list
                const wName = entryData.warehouse_name || warehouses.find(w => w.id === entryData.warehouse_id)?.name;
                if (wName) {
                    const canonicalWh = warehouses.find(w => w.name === wName);
                    if (canonicalWh) {
                        resolvedWarehouseId = canonicalWh.id;
                        resolvedWarehouseName = wName;
                    }
                }
            }

            // Clean up entryData to remove undefined fields like id or unwanted props
            const { id: _ignoredId, ...restEntryData } = entryData;

            const docData: any = {
                ...restEntryData,
                sheet_id: resolvedSheetId,   // auto-resolved
                quantity: finalQty,
                warehouse_id: resolvedWarehouseId || null,
                warehouse_name: resolvedWarehouseName || null,
                updatedAt: serverTimestamp()
            };

            if (!entryData.id) {
                docData.createdAt = serverTimestamp();
            }

            // 2. Handle Stock Updates
            const productId = entryData.product_id;
            const supplierName = entryData.supplier_name;
            const isCarryForward = entryData.is_carry_forward === true && entryData.transaction_type !== 'Opening';

            if (productId && supplierName) {
                const globalStockRef = doc(db, prodCollName, productId);
                const supplierStockRef = doc(db, prodCollName, productId, 'supplier_stock', supplierName);
                const warehouseId = entryData.warehouse_id;
                const warehouseStockRef = warehouseId ? doc(db, prodCollName, productId, 'warehouse_stock', warehouseId) : null;

                if (entryData.id) {
                    // --- EDIT CASE ---
                    const oldTransRef = doc(db, transCollName, entryData.id);
                    const oldTransSnap = await getDoc(oldTransRef);

                    if (oldTransSnap.exists()) {
                        const oldData = oldTransSnap.data();
                        const wasCarryForward = oldData.is_carry_forward === true && oldData.transaction_type !== 'Opening';

                        // Reverse Old Effect ONLY if it wasn't a carry-forward
                        if (!wasCarryForward && oldData.product_id) {
                            const oldQty = Number(oldData.quantity || 0);
                            const oldSupplier = oldData.manual_supplier_name || oldData.supplier_name;
                            const oldWarehouseId = oldData.warehouse_id;

                            batch.update(doc(db, prodCollName, oldData.product_id), {
                                current_stock: increment(-oldQty),
                                updatedAt: serverTimestamp()
                            });
                            if (oldSupplier) {
                                batch.set(doc(db, prodCollName, oldData.product_id, 'supplier_stock', oldSupplier), {
                                    current_stock: increment(-oldQty),
                                    updatedAt: serverTimestamp()
                                }, { merge: true });
                            }
                            if (oldWarehouseId) {
                                batch.set(doc(db, prodCollName, oldData.product_id, 'warehouse_stock', oldWarehouseId), {
                                    current_stock: increment(-oldQty),
                                    updatedAt: serverTimestamp()
                                }, { merge: true });
                            }
                        }
                    }

                    // Update Transaction Doc
                    batch.update(doc(db, transCollName, entryData.id), docData);

                    // Apply New Effect ONLY if it's NOT a carry-forward
                    if (!isCarryForward) {
                        batch.update(globalStockRef, { current_stock: increment(finalQty) });
                        batch.set(supplierStockRef, { current_stock: increment(finalQty), updatedAt: serverTimestamp() }, { merge: true });
                        if (warehouseStockRef) {
                            batch.set(warehouseStockRef, { current_stock: increment(finalQty), updatedAt: serverTimestamp() }, { merge: true });
                        }
                    }

                } else {
                    // --- NEW CASE ---
                    const newTransRef = doc(collection(db, transCollName));
                    batch.set(newTransRef, docData);

                    // Apply New Effect ONLY if it's NOT a carry-forward
                    if (!isCarryForward) {
                        batch.update(globalStockRef, { current_stock: increment(finalQty) });
                        batch.set(supplierStockRef, { current_stock: increment(finalQty), updatedAt: serverTimestamp() }, { merge: true });
                        if (warehouseStockRef) {
                            batch.set(warehouseStockRef, { current_stock: increment(finalQty), updatedAt: serverTimestamp() }, { merge: true });
                        }
                    }
                }
            } else {
                // Determine if we should allow saving without product/supplier?
                // Modal enforces it.
                throw new Error("Product or Supplier missing");
            }

            // 3. Handle Job Card Phase Progression (Store -> Production)
            if (section === 'raw_material' && isIssue && entryData.job_card_id && !entryData.id) {
                const jcRef = doc(db, 'job_cards', entryData.job_card_id);
                const jcSnap = await getDoc(jcRef);
                if (jcSnap.exists()) {
                    const jcData = jcSnap.data();
                    if (jcData.currentPhase === 4) {
                        batch.update(jcRef, {
                            currentPhase: 5,
                            'phaseStatuses.4': 'completed',
                            updatedAt: serverTimestamp()
                        });
                    }
                }
            }

            await batch.commit();
            setStatus('Saved');
            setAddEntryModal({ isOpen: false, data: undefined });
            // Navigate to the sheet where the entry landed
            setSelectedSheet(resolvedSheet);
            setTimeout(() => setStatus(null), 2000);

        } catch (e: any) {
            console.error(e);
            setRenderError('Save Error: ' + e.message);
            setStatus('Error');
        } finally {
            setIsProcessing(false);
        }
    };

    // --- Transfer Handler ---
    const handleTransfer = async (transferData: any) => {
        if (!selectedSheet) return;

        if (selectedSheet.isLocked) {
            alert("This sheet is locked. You cannot transfer stock.");
            return;
        }

        setIsProcessing(true);
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions'; // Use section dynamically though Transfer is usually RM
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';

        try {
            const batch = writeBatch(db);

            // Handle Update (Reversal of Old Stock of THIS specific transaction)
            if (transferData.id) {
                const oldTransRef = doc(db, transCollName, transferData.id);
                const oldTransSnap = await getDoc(oldTransRef);
                if (oldTransSnap.exists()) {
                    const old = oldTransSnap.data();

                    // Reverse Old Source (Increment back what was taken)
                    const oldSrcRef = doc(db, prodCollName, old.product_id, 'warehouse_stock', old.source_warehouse_id);
                    batch.set(oldSrcRef, { current_stock: increment(Number(old.quantity)) }, { merge: true });

                    // Reverse Old Dest (Decrement back what was given)
                    const oldDestRef = doc(db, prodCollName, old.product_id, 'warehouse_stock', old.dest_warehouse_id);
                    batch.set(oldDestRef, { current_stock: increment(-Number(old.quantity)) }, { merge: true });
                }

                // Update Transaction Doc
                const updateData = {
                    ...transferData,
                    updatedAt: serverTimestamp()
                };
                batch.update(oldTransRef, updateData);
            } else {
                // Create New
                const newTransRef = doc(collection(db, transCollName));
                // Destructure to remove 'id' (which might be undefined) from the spread
                const { id: _ignoredId, ...cleanTransferData } = transferData;

                const transData = {
                    ...cleanTransferData,
                    sheet_id: selectedSheet.id,
                    createdAt: serverTimestamp()
                };
                batch.set(newTransRef, transData);
            }

            // Apply New Stock (Common for Create & Update)
            // Source: Decrement
            const sourceRef = doc(db, prodCollName, transferData.product_id, 'warehouse_stock', transferData.source_warehouse_id);
            batch.set(sourceRef, { current_stock: increment(-Number(transferData.quantity)), updatedAt: serverTimestamp() }, { merge: true });

            // Dest: Increment
            const destRef = doc(db, prodCollName, transferData.product_id, 'warehouse_stock', transferData.dest_warehouse_id);
            batch.set(destRef, { current_stock: increment(Number(transferData.quantity)), updatedAt: serverTimestamp() }, { merge: true });

            await batch.commit();
            setStatus('Transfer Saved');
            setTimeout(() => setStatus(null), 2000);
        } catch (e: any) {
            console.error(e);
            setRenderError('Transfer Error: ' + e.message);
        } finally {
            setIsProcessing(false);
        }
    }

    const withTimeout = async <T,>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
        const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`TIMEOUT: ${errorMessage}`)), ms);
        });
        return Promise.race([promise, timeout]);
    };

    const handleDeleteSheet = async () => {
        const sheet = deleteSheetConfirmation.sheet;
        if (!sheet || !isAdmin) return;

        if (sheet.isLocked) {
            alert("This sheet is locked. You cannot delete it.");
            setDeleteSheetConfirmation({ isOpen: false, sheet: null });
            return;
        }

        setIsProcessing(true);
        setStatus('Deleting Sheet...');

        const sheetCollName = section === 'finished_goods' ? 'fg_inventory_sheets' : 'rm_inventory_sheets';
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';

        try {
            // 1. Fetch all transactions for this sheet
            const q = query(collection(db, transCollName), where('sheet_id', '==', sheet.id));
            const transSnap = await getDocs(q);

            const batch = writeBatch(db);

            // 2. Reverse Stock Impact & Delete Transactions
            for (const tDoc of transSnap.docs) {
                const t = tDoc.data();
                const isCarryForward = t.is_carry_forward === true || t.transaction_type === 'Opening';
                const qty = Number(t.quantity || 0);

                if (!isCarryForward && t.product_id) {
                    // Reverse Global Stock
                    batch.update(doc(db, prodCollName, t.product_id), {
                        current_stock: increment(-qty),
                        updatedAt: serverTimestamp()
                    });

                    // Reverse Supplier Stock
                    const supplierName = t.manual_supplier_name || t.supplier_name;
                    if (section === 'raw_material' && supplierName) {
                        const suppStockRef = doc(db, prodCollName, t.product_id, 'supplier_stock', supplierName);
                        batch.set(suppStockRef, {
                            current_stock: increment(-qty),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }

                    // Reverse Warehouse Stock
                    const warehouseId = t.warehouse_id;
                    if (section === 'raw_material' && warehouseId) {
                        const whStockRef = doc(db, prodCollName, t.product_id, 'warehouse_stock', warehouseId);
                        batch.set(whStockRef, {
                            current_stock: increment(-qty),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }
                }

                // Delete Transaction
                batch.delete(tDoc.ref);
            }

            // 3. Delete the Sheet itself
            batch.delete(doc(db, sheetCollName, sheet.id));

            await batch.commit();

            if (selectedSheet?.id === sheet.id) {
                setSelectedSheet(null);
            }

            setStatus('Sheet Deleted');
            setTimeout(() => setStatus(null), 2000);
        } catch (error: any) {
            console.error("Error deleting sheet:", error);
            setRenderError("Delete Sheet Error: " + error.message);
        } finally {
            setIsProcessing(false);
            setDeleteSheetConfirmation({ isOpen: false, sheet: null });
        }
    }

    const addRow = async () => {
        if (!selectedSheet) return;

        if (selectedSheet.isLocked) {
            alert("Sheet is locked.");
            return;
        }

        setIsProcessing(true);
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';

        const newRow = {
            sheet_id: selectedSheet.id,
            date: new Date().toISOString().split('T')[0],
            product_id: '',
            type: 'Manual',
            transaction_type: 'Opening',
            section: section,
            createdAt: serverTimestamp()
        };

        try {
            await addDoc(collection(db, transCollName), newRow);
        } catch (error: any) {
            setRenderError('Add Row Error: ' + error.message);
        } finally {
            setIsProcessing(false);
        }
    }

    // --- DN Status Update State ---
    const [dnUpdate, setDnUpdate] = useState<{ isOpen: boolean; grnNo: string }>({ isOpen: false, grnNo: '' });

    const onCellValueChanged = useCallback(async (params: any) => {
        const { data, colDef, newValue, oldValue } = params;
        const field = colDef.field;

        if (!field || newValue === oldValue) return;

        if (selectedSheet?.isLocked) {
            alert("Current sheet is locked.");
            // Revert value? AgGrid might need a refresh, but usually preventing editing via colDef is better.
            // This is a failsafe.
            params.node.setDataValue(field, oldValue);
            return;
        }

        const cleaned = typeof newValue === 'string' ? newValue.trim() : newValue;

        // --- SPECIAL LOGIC: Negate Qty for 'Issued' ---
        let finalValue = cleaned;
        let updates: any = { [field]: cleaned };

        // Determine effective Product Name and ID
        const currentProductName = field === 'product_name' ? cleaned : data.product_name;
        // Try to resolve Product ID from the Name (Optimistic Resolution)
        const product = productsList.find(p => p.description === currentProductName);
        const resolvedProductId = product ? product.id : data.product_id;

        if (product && resolvedProductId !== data.product_id) {
            updates.product_id = resolvedProductId;

            // Auto-fill Product Specs (L/W/G/UOM)
            if (product.length) updates.length = Number(product.length);
            if (product.width) updates.width = Number(product.width);
            if (product.gsm) updates.gsm = Number(product.gsm);
            if (product.uom) updates.uom = product.uom;
            if (product.rate) updates.rate = Number(product.rate);
            if (product.item_code) updates.item_code = product.item_code;
            if (product.category_name) updates.category_name = product.category_name;
        } else if (field === 'item_code') {
            // Reverse lookup: Item Code -> Product
            const matchedProduct = productsList.find(p => p.item_code === cleaned);
            if (matchedProduct) {
                updates.product_id = matchedProduct.id;
                updates.product_name = matchedProduct.description;
                if (matchedProduct.uom) updates.uom = matchedProduct.uom;
                if (matchedProduct.rate) updates.rate = Number(matchedProduct.rate);
                if (matchedProduct.category_name) updates.category_name = matchedProduct.category_name;
            }
        }

        // --- Finished Goods: Auto-calculate Quantity from Boxes ---
        if (section === 'finished_goods' && (field === 'no_of_boxes' || field === 'qty_per_box')) {
            const boxes = field === 'no_of_boxes' ? Number(cleaned) : Number(data.no_of_boxes || 0);
            const packing = field === 'qty_per_box' ? Number(cleaned) : Number(data.qty_per_box || 0);

            if (boxes > 0 && packing > 0) {
                const calculatedQty = boxes * packing;
                updates.quantity = calculatedQty;
                updates.grand_total = calculatedQty;
            }
        }

        if (field === 'transaction_type' || field === 'quantity' || field === 'product_name' || field === 'item_code' || updates.quantity !== undefined) {
            const currentType = field === 'transaction_type' ? cleaned : data.transaction_type;
            const currentQty = updates.quantity !== undefined ? Number(updates.quantity) : (field === 'quantity' ? Number(cleaned) : Number(data.quantity));
            const isIssue = currentType === 'Issued' || currentType === 'Issue' || currentType === 'Delivery Note';

            const targetQty = isIssue ? -Math.abs(currentQty) : Math.abs(currentQty);

            if (targetQty !== Number(data.quantity)) {

                // --- STOCK CHECK FOR ISSUE ---
                if (isIssue) {
                    const currentStock = product ? (product.current_stock || 0) : 0;

                    // Pre-Transaction Stock
                    let preTransactionStock = currentStock;
                    const oldQty = Number(data.quantity || 0);
                    preTransactionStock = currentStock - oldQty;

                    if (preTransactionStock + targetQty < 0) {
                        const requested = Math.abs(targetQty);
                        const available = preTransactionStock;

                        setStockAlert({
                            isOpen: true,
                            title: 'Insufficient Stock',
                            message: `You can't issue ${product?.description || 'this item'} with quantity ${requested} because stock is only ${available}.`
                        });

                        params.node.setDataValue(field, oldValue);
                        return; // Stop saving
                    }
                }

                updates.quantity = targetQty;
                const { length, width, gsm, rate } = data;
                if (gsm > 0 && length && width) {
                    const kgs = Number(((length * 25.4 / 1000) * (width * 25.4 / 1000) * (gsm / 1000) * targetQty).toFixed(2));
                    updates.calculated_kgs = kgs;
                    updates.total_amount = Number((kgs * rate).toFixed(2));
                } else {
                    updates.total_amount = Number((targetQty * rate).toFixed(2));
                }
            }
        }

        setStatus('Saving...');
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';

        try {
            const docRef = doc(db, transCollName, data.id);

            const oldProductId = data.product_id;
            const newProductId = resolvedProductId;
            const oldQty = Number(data.quantity || 0);
            const newQty = updates.quantity !== undefined ? Number(updates.quantity) : oldQty;
            const isCarryForward = updates.transaction_type === 'Opening' || data.transaction_type === 'Opening' || data.is_carry_forward === true;

            if (newProductId) {
                if (oldProductId !== newProductId) {
                    // Reversed Old ONLY if old was not carry-forward
                    const wasCarryForward = data.transaction_type === 'Opening' || data.is_carry_forward === true;
                    if (oldProductId && !wasCarryForward) {
                        await updateDoc(doc(db, prodCollName, oldProductId), {
                            current_stock: increment(-oldQty),
                            updatedAt: serverTimestamp()
                        });
                    }
                    // Apply New ONLY if new is not carry-forward
                    if (!isCarryForward) {
                        await updateDoc(doc(db, prodCollName, newProductId), {
                            current_stock: increment(newQty),
                            updatedAt: serverTimestamp()
                        });
                    }
                } else if (newQty !== oldQty && !isCarryForward) {
                    await updateDoc(doc(db, prodCollName, newProductId), {
                        current_stock: increment(newQty - oldQty),
                        updatedAt: serverTimestamp()
                    });
                }
            }

            await updateDoc(docRef, {
                ...updates,
                updatedAt: serverTimestamp()
            });
            setStatus('Saved');
            setTimeout(() => setStatus(null), 2000);
        } catch (e: any) {
            console.error(e);
            setRenderError('Update Error: ' + e.message);
            setStatus('Error Saving');
        }
    }, [productsList, section]);

    const requestDeleteRow = useCallback((id: string) => {
        setDeleteConfirmation({ isOpen: true, rowId: id })
    }, [])

    const executeDeleteRow = useCallback(async () => {
        const id = deleteConfirmation.rowId
        if (!id) return;

        if (selectedSheet?.isLocked) {
            alert("This sheet is locked. Delete is disabled.");
            setDeleteConfirmation({ isOpen: false, rowId: null });
            return;
        }

        setIsProcessing(true);
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';

        try {
            const batch = writeBatch(db);

            const docRef = doc(db, transCollName, id);
            const snap = await getDoc(docRef);

            if (snap.exists()) {
                const data = snap.data();
                const isCarryForward = data.is_carry_forward === true || data.transaction_type === 'Opening';
                const qtyToReverse = Number(data.quantity || 0);

                if (!isCarryForward && data.product_id) {
                    const productRef = doc(db, prodCollName, data.product_id);
                    batch.update(productRef, {
                        current_stock: increment(-qtyToReverse),
                        updatedAt: serverTimestamp()
                    });

                    const supplierName = data.manual_supplier_name || data.supplier_name;
                    if (section === 'raw_material' && supplierName) {
                        const supplierStockRef = doc(db, prodCollName, data.product_id, 'supplier_stock', supplierName);
                        batch.set(supplierStockRef, {
                            current_stock: increment(-qtyToReverse),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }
                    const warehouseId = data.warehouse_id;
                    if (section === 'raw_material' && warehouseId) {
                        const whStockRef = doc(db, prodCollName, data.product_id, 'warehouse_stock', warehouseId);
                        batch.set(whStockRef, {
                            current_stock: increment(-qtyToReverse),
                            updatedAt: serverTimestamp()
                        }, { merge: true });
                    }
                }

                batch.delete(docRef);
                await batch.commit();
            }
        } catch (error: any) {
            console.error(error);
            setRenderError('Delete Error: ' + error.message);
        } finally {
            setIsProcessing(false);
            setDeleteConfirmation({ isOpen: false, rowId: null });
        }
    }, [deleteConfirmation.rowId, section]);

    // --- Export Logic ---
    const handleExport = useCallback(() => {
        if (!gridApi) return;

        const allCols = gridApi.getColumns();
        const visibleCols = allCols.filter((col: any) => col.getColId() !== '0' && col.isVisible());
        const colHeaders = visibleCols.map((col: any) => col.getColDef().headerName);

        const rowData: any[] = [];
        gridApi.forEachNodeAfterFilterAndSort((node: any) => {
            const row: any = {};
            visibleCols.forEach((col: any) => {
                const key = col.getColId();
                const header = col.getColDef().headerName;
                const value = gridApi.getValue(key, node);
                row[header] = value;
            });
            rowData.push(row);
        });

        const worksheet = XLSX.utils.json_to_sheet(rowData, { header: colHeaders });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");

        const fileName = `Inventory_${selectedSheet ? `${monthNames[selectedSheet.month - 1]}_${selectedSheet.year}` : 'Export'}.xlsx`;
        XLSX.writeFile(workbook, fileName);
    }, [gridApi, selectedSheet]);



    const columnDefs = useMemo<ColDef[]>(() => {
        const isLocked = selectedSheet?.isLocked;

        const commonCols: ColDef[] = [
            {
                headerName: 'Actions',
                field: '0',
                pinned: 'left',
                width: 100,
                cellRenderer: (params: any) => (
                    <div className="flex gap-2 justify-center items-center h-full">
                        {/* Only show DN Update button for FG Delivery Notes */}
                        {/* {section === 'finished_goods' && params.data.transaction_type === 'Delivery Note' && (
                            <button
                                onClick={() => {
                                    console.log("Update DN Clicked. Data:", params.data);
                                    setDnUpdate({ isOpen: true, grnNo: params.data.grn_no });
                                }}
                                className="p-1 hover:bg-blue-100 rounded text-blue-600"
                                title="Update Status (OGP)"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                            </button>
                        )} */}
                        <button onClick={() => setDeleteConfirmation({ isOpen: true, rowId: params.data.id })} className="p-1 hover:bg-gray-200 rounded">
                            <img src={deleteIcon} alt="Delete" className="w-4 h-4" />
                        </button>
                    </div>
                ),
                suppressMenu: true
            },
            {
                field: 'date',
                headerName: 'Date',
                width: 120,
                editable: false,
                cellEditor: 'agDateCellEditor',
                valueFormatter: formatDate,
                filter: 'agDateColumnFilter'
            }
        ];

        if (section === 'finished_goods') {
            return [
                ...commonCols.slice(1), // Remove left 'Actions' (index 0)
                {
                    field: 'transaction_type',
                    headerName: 'Type',
                    width: 140,
                    filter: true
                },
                {
                    field: 'manual_supplier_name',
                    headerName: 'Customer',
                    width: 150,
                    editable: false, // Restrictions: No Edit
                    cellEditor: SearchableSelectCellEditor,
                    cellEditorParams: { values: options.suppliers },
                    filter: true
                },
                {
                    field: 'po_no',
                    headerName: 'PO No.',
                    width: 120,
                    editable: false, // Restrictions: No Edit
                    filter: true,
                    valueGetter: (params: any) => params.data.po_no || params.data.customer_po_no || ''
                },
                {
                    field: 'manual_category_name',
                    headerName: 'Category',
                    width: 130,
                    editable: false, // Restrictions: No Edit
                    cellEditor: SearchableSelectCellEditor,
                    cellEditorParams: { values: options.categories },
                    filter: true
                },
                {
                    field: 'item_code',
                    headerName: 'Item Code',
                    width: 130,
                    editable: false, // Restrictions: No Edit
                    filter: true,
                    valueGetter: (params: any) => {
                        if (params.data.item_code) return params.data.item_code;
                        const product = productsList.find((p: any) => p.id === params.data.product_id);
                        return product ? product.item_code : '';
                    }
                },
                {
                    field: 'manual_product_name',
                    headerName: 'Product',
                    width: 200,
                    editable: false, // Restrictions: No Edit
                    cellEditor: SearchableSelectCellEditor,
                    cellEditorParams: { values: options.products },
                    filter: true
                },
                {
                    field: 'uom',
                    headerName: 'UOM',
                    width: 80,
                    editable: false, // Restrictions: No Edit
                    cellEditor: SearchableSelectCellEditor,
                    cellEditorParams: { values: options.uoms },
                    filter: true
                },
                {
                    field: 'qty_per_box',
                    headerName: 'Qty/Box',
                    width: 100,
                    editable: false, // Restrictions: No Edit
                    valueFormatter: formatNumber,
                    type: 'numericColumn'
                },
                {
                    field: 'box_qty',
                    headerName: 'Cartons',
                    width: 100,
                    editable: false, // Restrictions: No Edit
                    valueFormatter: formatNumber,
                    type: 'numericColumn',
                    valueGetter: (params: any) => params.data.box_qty || params.data.no_of_boxes || 0
                },
                {
                    field: 'quantity',
                    headerName: 'Total Qty',
                    width: 120,
                    editable: false, // Restrictions: No Edit
                    valueGetter: (params: any) => params.data.transaction_type === 'Sales Order' ? (params.data.display_quantity || 0) : params.data.quantity,
                    valueFormatter: formatNumber,
                    cellClassRules: {
                        'bg-green-100 text-green-800 font-bold': (params: any) => params.data.transaction_type === 'Manufactured Product',
                        'bg-blue-100 text-blue-800 font-bold': (params: any) => params.data.transaction_type === 'Sales Order',
                        'bg-red-100 text-red-800 font-bold': (params: any) => typeof params.value === 'number' && params.value < 0
                    },
                    text: 'numericColumn',
                    aggFunc: 'sum'
                },
                {
                    field: 'tolerance',
                    headerName: 'Tolerance',
                    width: 100,
                    editable: false, // Restrictions: No Edit
                    valueFormatter: formatNumber,
                    cellClassRules: numericCellClassRules,
                    type: 'numericColumn'
                }
                // No Action Column for FG
            ];
        }

        // Raw Material Columns
        return [
            // Removed commonCols[0] (Left Actions) to avoid duplicate
            { ...commonCols[1] }, // Date
            {
                field: 'transaction_type',
                headerName: 'Type',
                width: 120,
            },
            {
                field: 'supplier_name',
                headerName: 'Supplier',
                width: 150,
                editable: false,
            },
            {
                field: 'category_name',
                headerName: 'Item Category',
                width: 130,
                editable: false,
            },
            {
                field: 'warehouse_name',
                headerName: 'Warehouse',
                width: 120,
                editable: false,
            },
            {
                field: 'product_name',
                headerName: 'Item Description',
                editable: false,
                width: 400,
            },
            {
                field: 'uom',
                headerName: 'UOM',
                editable: false,
                width: 100,
            },
            {
                field: 'quantity',
                headerName: 'Quantity',

                editable: (params) => !isLocked && params.data.transaction_type !== 'Purchased',
                width: 100,
                type: 'numericColumn',
                valueFormatter: formatNumber,
                cellClassRules: numericCellClassRules
            },
            {
                field: 'length',
                headerName: 'L',
                editable: (params) => !isLocked && !['Purchase', 'Purchased'].includes(params.data.transaction_type),
                width: 70,
                type: 'numericColumn',
                valueFormatter: formatNumber,
                cellClassRules: numericCellClassRules
            },
            {
                field: 'width',
                headerName: 'W',
                editable: (params) => !isLocked && !['Purchase', 'Purchased'].includes(params.data.transaction_type),
                width: 70,
                type: 'numericColumn',
                valueFormatter: formatNumber,
                cellClassRules: numericCellClassRules
            },
            {
                field: 'gsm',
                headerName: 'G',
                editable: (params) => !isLocked && !['Purchase', 'Purchased'].includes(params.data.transaction_type),
                width: 70,
                type: 'numericColumn',
                valueFormatter: formatNumber,
                cellClassRules: numericCellClassRules
            },
            {
                headerName: 'KGS',
                width: 100,
                valueGetter: (params) => {
                    if (!params.data) return 0
                    const { length, width, gsm, quantity } = params.data
                    if (gsm > 0 && length && width && quantity) {
                        return Number(((length * 25.4 / 1000) * (width * 25.4 / 1000) * (gsm / 1000) * quantity).toFixed(2))
                    }
                    return 0
                },
                type: 'numericColumn',
                valueFormatter: formatNumber,
                cellClassRules: numericCellClassRules
            },
            {
                field: 'rate',
                headerName: 'Rate',
                editable: (params) => !isLocked && !['Purchase', 'Purchased'].includes(params.data.transaction_type),
                width: 120,
                type: 'numericColumn',
                valueFormatter: formatCurrency,
                cellClassRules: numericCellClassRules
            },
            {
                headerName: 'Amount',
                width: 140,
                valueGetter: (params) => {
                    if (!params.data) return 0
                    const { length, width, gsm, quantity, rate } = params.data
                    let kgs = 0
                    if (gsm > 0 && length && width && quantity) {
                        kgs = (length * 25.4 / 1000) * (width * 25.4 / 1000) * (gsm / 1000) * quantity
                    }
                    if (kgs === 0) {
                        return Number((rate * quantity).toFixed(2))
                    }
                    return Number((rate * kgs).toFixed(2))
                },
                type: 'numericColumn',
                valueFormatter: formatCurrency,
                cellClassRules: numericCellClassRules
            },
            ...(isAdmin ? [{
                headerName: 'Actions',
                pinned: 'right' as 'right',
                width: 100,
                cellRenderer: (params: any) => (
                    <div className="flex gap-2 justify-center">
                        <button onClick={() => {
                            if (params.data.transaction_type === 'Transfer') {
                                setTransferModal({ isOpen: true, data: params.data });
                            } else {
                                setAddEntryModal({ isOpen: true, data: params.data });
                            }
                        }} disabled={isLocked || ['Purchase', 'Purchased'].includes(params.data.transaction_type)} className={`p-1 rounded transition ${isLocked || ['Purchase', 'Purchased'].includes(params.data.transaction_type) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-200'}`}>
                            <img src={editIcon} alt="Edit" className="w-4 h-4 opacity-60 hover:opacity-100" />
                        </button>
                        <button onClick={() => requestDeleteRow(params.data.id)} disabled={isLocked || ['Purchase', 'Purchased'].includes(params.data.transaction_type)} className={`p-1 rounded transition ${isLocked || ['Purchase', 'Purchased'].includes(params.data.transaction_type) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-red-100'}`}>
                            <img src={deleteIcon} alt="Delete" className="w-4 h-4 opacity-60 hover:opacity-100" />
                        </button>
                    </div>
                )
            }] : [])
        ]
    }, [requestDeleteRow, options, section, isAdmin, selectedSheet, productsList]) // Added selectedSheet and productsList dependency

    const toggleLock = useCallback(async () => {
        if (!selectedSheet || !isAdmin) return;

        setIsProcessing(true);
        const sheetCollName = section === 'finished_goods' ? 'fg_inventory_sheets' : 'rm_inventory_sheets';
        try {
            const sheetRef = doc(db, sheetCollName, selectedSheet.id);
            await updateDoc(sheetRef, {
                isLocked: !selectedSheet.isLocked,
                updatedAt: serverTimestamp()
            });
            // State will update via snapshot
            setStatus(selectedSheet.isLocked ? "Sheet Unlocked" : "Sheet Locked");
            setTimeout(() => setStatus(null), 2000);
        } catch (error: any) {
            console.error("Error toggling lock:", error);
            setRenderError("Lock Error: " + error.message);
        } finally {
            setIsProcessing(false);
        }
    }, [selectedSheet, isAdmin, section]);

    const onGridReady = useCallback(async (params: any) => {
        setGridApi(params.api)
        if (user) {
            try {
                const savedState = await getUserLayout(user.uid, `inventory_${section}`);
                if (savedState) {
                    params.api.applyColumnState({ state: savedState, applyOrder: true });
                }
            } catch (e) {
                console.error("Failed to load saved layout", e);
            }
        }
    }, [user, section])

    const groupedSheets = useMemo(() => {
        const groups: { [key: number]: InventorySheet[] } = {}
        sheets.forEach(s => {
            if (!groups[s.year]) groups[s.year] = []
            groups[s.year].push(s)
        })
        return groups
    }, [sheets])

    // --- Import Inventory Handler ---
    const handleImportInventory = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        setIsProcessing(true)
        setStatus("Reading File...")

        const reader = new FileReader()
        reader.onload = async (e) => {
            const data = e.target?.result
            if (!data) {
                setIsProcessing(false)
                return
            }

            try {
                // 1. Parse CSV
                const workbook = XLSX.read(data, { type: 'array' })
                const sheetName = workbook.SheetNames[0]
                const worksheet = workbook.Sheets[sheetName]
                const jsonData = XLSX.utils.sheet_to_json(worksheet)

                setStatus(`Parsed ${jsonData.length} rows. preparing...`)

                // 2. Pre-fetch Data
                const [catsSnap, suppsSnap, prodsSnap, whSnap, sheetsSnap] = await Promise.all([
                    getDocs(collection(db, 'rm_categories')),
                    getDocs(collection(db, 'rm_suppliers')),
                    getDocs(collection(db, 'rm_products')),
                    getDocs(collection(db, 'warehouses')),
                    getDocs(query(collection(db, 'rm_inventory_sheets'), where('month', '==', 2), where('year', '==', 2026)))
                ]);

                // Maps for Case-Insensitive Lookup
                const catMap = new Map();
                catsSnap.docs.forEach(d => catMap.set(d.data().name.toLowerCase(), d.id));

                const suppMap = new Map();
                suppsSnap.docs.forEach(d => suppMap.set(d.data().name.toLowerCase(), d.id));

                const prodMap = new Map();
                prodsSnap.docs.forEach(d => {
                    const data = d.data();
                    // Map by Description (or Item Name)
                    prodMap.set(data.description.toLowerCase(), { id: d.id, ...data });
                });

                const whMap = new Map();
                whSnap.docs.forEach(d => whMap.set(d.data().name.toLowerCase(), { id: d.id, name: d.data().name }));

                // 3. Get/Create Feb 2026 Sheet
                let sheetId = '';
                if (!sheetsSnap.empty) {
                    const existingSheetDoc = sheetsSnap.docs[0];
                    if (existingSheetDoc.data().isLocked) {
                        alert("The target sheet (Feb 2026) is LOCKED. Cannot import.");
                        setIsProcessing(false);
                        return;
                    }
                    sheetId = existingSheetDoc.id;
                } else {
                    const newSheetRef = await addDoc(collection(db, 'rm_inventory_sheets'), {
                        month: 2,
                        year: 2026,
                        section: 'raw_material',
                        createdAt: serverTimestamp()
                    });
                    sheetId = newSheetRef.id;
                }

                // 4. Process Rows
                let processedCount = 0;
                const batchSize = 50; // Smaller batch size due to multiple writes per row
                const chunks = [];
                for (let i = 0; i < jsonData.length; i += batchSize) {
                    chunks.push(jsonData.slice(i, i + batchSize));
                }

                for (const chunk of chunks) {
                    const batch = writeBatch(db);

                    for (const row of chunk as any[]) {
                        // Normalize Keys
                        const normalized: any = {};
                        Object.keys(row).forEach(k => normalized[k.trim().toLowerCase().replace(/[^a-z0-9]/g, '')] = row[k]);

                        // Extract Fields
                        const whName = normalized['warehouse'];
                        const suppName = normalized['suppliername'] || normalized['supplier'];
                        const catName = normalized['itemcategory'] || normalized['category'];
                        const prodName = normalized['product'] || normalized['productname'] || normalized['item'];
                        const length = Number(normalized['l'] || 0);
                        const width = Number(normalized['w'] || 0);
                        const gsm = Number(normalized['g'] || 0);
                        const uom = normalized['uom'] || 'Kg';
                        const qty = Number(normalized['qty'] || normalized['quantity'] || 0);
                        const rate = Number(normalized['rate'] || 0);

                        if (!prodName || qty === 0) continue;

                        // Lookup / Create Entities

                        // Warehouse
                        let whId = '';
                        let finalWhName = whName;
                        if (whName) {
                            const whObj = whMap.get(whName.toLowerCase());
                            if (whObj) {
                                whId = whObj.id;
                                finalWhName = whObj.name;
                            } else {
                                const newRef = doc(collection(db, 'warehouses'));
                                batch.set(newRef, { name: whName });
                                whId = newRef.id;
                                whMap.set(whName.toLowerCase(), { id: whId, name: whName });
                            }
                        }

                        // Supplier
                        let suppId = ''; // Not strictly needed for transaction doc if storing name, but good for linking
                        if (suppName) {
                            if (!suppMap.has(suppName.toLowerCase())) {
                                const newRef = doc(collection(db, 'rm_suppliers'));
                                batch.set(newRef, { name: suppName, type: 'raw_material', createdAt: serverTimestamp() });
                                suppMap.set(suppName.toLowerCase(), newRef.id);
                            }
                        }

                        // Category
                        let catId = ''; // Used for product creation
                        if (catName) {
                            if (!catMap.has(catName.toLowerCase())) {
                                const newRef = doc(collection(db, 'rm_categories'));
                                batch.set(newRef, { name: catName, type: 'raw_material', createdAt: serverTimestamp() });
                                catMap.set(catName.toLowerCase(), newRef.id);
                                catId = newRef.id;
                            } else {
                                catId = catMap.get(catName.toLowerCase());
                            }
                        }

                        // Product
                        let prodId = '';
                        let prodData = prodMap.get(prodName.toLowerCase());

                        if (prodData) {
                            prodId = prodData.id;
                            // Update Rate if changed
                            if (prodData.rate !== rate) {
                                batch.update(doc(db, 'rm_products', prodId), { rate: rate });
                            }
                        } else {
                            const newRef = doc(collection(db, 'rm_products'));
                            prodId = newRef.id;
                            const newProd = {
                                description: prodName,
                                category_name: catName,
                                category_id: catId, // Might be empty if no category provided, but user said all mostly exist
                                uom: uom,
                                length,
                                width,
                                gsm,
                                rate,
                                current_stock: 0,
                                min_stock_level: 0,
                                type: 'raw_material',
                                createdAt: serverTimestamp()
                            };
                            batch.set(newRef, newProd);
                            prodMap.set(prodName.toLowerCase(), { id: prodId, ...newProd });
                        }

                        // Calculations
                        let calculated_kgs = 0;
                        if (length && width && gsm) {
                            calculated_kgs = Number(((length * 25.4 / 1000) * (width * 25.4 / 1000) * (gsm / 1000) * qty).toFixed(2));
                        }
                        const amount = Number((qty * rate).toFixed(2));

                        // Create Transaction
                        const transRef = doc(collection(db, 'rm_inventory_transactions'));
                        batch.set(transRef, {
                            sheet_id: sheetId,
                            date: '2026-02-01',
                            transaction_type: 'Opening',
                            section: 'raw_material',
                            supplier_name: suppName,
                            category_name: catName,
                            product_id: prodId,
                            product_name: prodName,
                            length,
                            width,
                            gsm,
                            uom,
                            quantity: qty,
                            rate,
                            amount,
                            total_amount: amount,
                            calculated_kgs,
                            warehouse_id: whId,
                            warehouse_name: finalWhName,
                            createdAt: serverTimestamp()
                        });

                        // Stock Updates (Increment)
                        // Global Stock
                        batch.update(doc(db, 'rm_products', prodId), {
                            current_stock: increment(qty)
                        });

                        // Supplier Stock
                        if (suppName) {
                            const suppStockRef = doc(db, 'rm_products', prodId, 'supplier_stock', suppName);
                            // Set with merge to handle create if missing
                            batch.set(suppStockRef, { current_stock: increment(qty) }, { merge: true });
                        }

                        // Warehouse Stock
                        if (whId) {
                            const whStockRef = doc(db, 'rm_products', prodId, 'warehouse_stock', whId);
                            batch.set(whStockRef, { current_stock: increment(qty) }, { merge: true });
                        }
                    }

                    await batch.commit();
                    processedCount += chunk.length;
                    setStatus(`Importing... ${processedCount}/${jsonData.length}`);
                }

                alert(`Successfully imported ${processedCount} entries into Feb 2026 Sheet.`);
                // Refresh?
                if (selectedSheet?.id === sheetId) {
                    // Force refresh logic if needed, but onSnapshot should handle it 
                }

            } catch (error) {
                console.error("Import failed:", error)
                setRenderError("Import Failed: " + String(error))
            } finally {
                setIsProcessing(false)
                setStatus(null)
                event.target.value = ''
            }
        }
        reader.readAsArrayBuffer(file)
    }

    return (
        <div className="flex h-[calc(100vh-100px)] bg-gray-100 overflow-hidden text-gray-800 relative">
            {/* Loading Overlay */}
            {isProcessing && <LoadingOverlay />}

            {/* Sidebar */}
            {showSidebar && (
                <div className="w-64 bg-white border-r flex flex-col flex-shrink-0 shadow-sm">
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                        <h3 className="font-bold text-gray-700">Inventory Sheets</h3>
                        <button onClick={() => setShowSidebar(false)} className="text-gray-400 hover:text-gray-600">âœ•</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                        {sheetsLoading ? (
                            <div className="p-4 text-sm text-gray-400 italic">Loading sheets...</div>
                        ) : Object.keys(groupedSheets).length === 0 ? (
                            <div className="p-4 text-sm text-gray-400 italic">No sheets found.</div>
                        ) : Object.keys(groupedSheets).sort((a, b) => Number(b) - Number(a)).map(year => (
                            <div key={year} className="mb-4">
                                <div className="font-bold text-sm text-gray-500 px-2 mb-1">{year}</div>
                                {groupedSheets[Number(year)].map(sheet => (
                                    <div key={sheet.id} className="relative group mb-1">
                                        <button
                                            onClick={() => setSelectedSheet(sheet)}
                                            className={`w-full text-left px-4 py-2 rounded text-sm transition-colors ${selectedSheet?.id === sheet.id ? 'bg-blue-600 text-white font-medium shadow-sm' : 'hover:bg-gray-100 text-gray-600'}`}
                                        >
                                            {monthNames[sheet.month - 1]}
                                        </button>
                                        {isAdmin && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteSheetConfirmation({ isOpen: true, sheet });
                                                }}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white rounded transition-all text-red-500"
                                                title="Delete Sheet"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>

                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <div className="p-4 bg-white border-b flex justify-between items-center shadow-sm flex-shrink-0 relative">
                    <div className="flex items-center gap-4">
                        {!showSidebar && <button onClick={() => setShowSidebar(true)} className="bg-gray-100 p-2 rounded hover:bg-gray-200 transition-colors">â˜°</button>}
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold text-gray-800">INVENTORY {selectedSheet ? `${monthNames[selectedSheet.month - 1].toUpperCase()} ${selectedSheet.year}` : ''}</h2>
                            {selectedSheet?.isLocked && (
                                <span className="bg-red-100 text-red-600 text-xs px-2 py-1 rounded-full font-bold border border-red-200 flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                                    LOCKED
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-4 relative">
                        {status && <span className={`text-sm font-bold px-3 py-1 rounded-full ${status === 'Error Saving' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600 animate-pulse'}`}>{status}</span>}

                        {/* Search Bar */}
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search all columns..."
                                className="pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all w-64"
                                value={quickFilterText}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setQuickFilterText(val);
                                    localStorage.setItem(`inventory_search_${section}`, val);
                                }}
                            />
                            {quickFilterText && (
                                <button
                                    onClick={() => {
                                        setQuickFilterText('');
                                        localStorage.setItem(`inventory_search_${section}`, '');
                                    }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            )}
                            <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        </div>

                        {/* Export Button */}
                        <button
                            onClick={handleExport}
                            className="px-4 py-2 rounded transition shadow-sm font-bold border bg-white text-green-700 hover:bg-green-50 border-green-200 flex items-center gap-2"
                            title="Export to Excel (.xlsx)"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            Export Excel
                        </button>

                        {/* Import Button - Raw Material Only */}
                        {/* {section === 'raw_material' && (
                            <label className="bg-green-600 text-white px-4 py-2 rounded-lg cursor-pointer hover:bg-green-700 font-bold transition-all shadow-md active:scale-95 flex items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                                Import
                                <input type="file" accept=".csv, .xlsx, .xls" className="hidden" onChange={handleImportInventory} />
                            </label>
                        )} */}

                        {/* Column Manager Button */}
                        <div className="relative">
                            <button
                                onClick={() => setShowColManager(!showColManager)}
                                className={`px-4 py-2 rounded transition shadow-sm font-bold border flex items-center gap-2 ${showColManager ? 'bg-gray-200 text-gray-800' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                                title="Manage Columns"
                            >
                                Columns
                            </button>
                            {showColManager && gridApi && (
                                <ColumnManager api={gridApi} onClose={() => setShowColManager(false)} gridId={`inventory_${section}`} />
                            )}
                        </div>

                        {/* Lock Button (Admin Only) */}
                        {isAdmin && selectedSheet && (
                            <button
                                onClick={toggleLock}
                                className={`px-4 py-2 rounded transition shadow-sm font-bold border flex items-center gap-2 ${selectedSheet.isLocked ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
                                title={selectedSheet.isLocked ? "Unlock this sheet" : "Lock this sheet to prevent changes"}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    {selectedSheet.isLocked ? (
                                        <>
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                        </>
                                    ) : (
                                        <>
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                            <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
                                        </>
                                    )}
                                </svg>
                                {selectedSheet.isLocked ? "Unlock" : "Lock"}
                            </button>
                        )}



                        {/* Add Entry: Admin OR (RM & PO Officer) OR (FG & Delivery Officer) */}
                        {/* Add Entry: Admin OR (RM & PO Officer) OR (FG & Delivery Officer) - BUT HIDDEN FOR FG based on request */}
                        {(section === 'raw_material' && isAdmin) && (
                            <button
                                onClick={() => setAddEntryModal({ isOpen: true })}
                                disabled={!selectedSheet || selectedSheet.isLocked}
                                className={`px-6 py-2 rounded transition shadow-md font-bold ${!selectedSheet || selectedSheet.isLocked ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                            >
                                Add Entry
                            </button>
                        )}

                        {/* Bulk Add: Same permissions as Add Entry */}
                        {(section === 'raw_material' && isAdmin) && (
                            <button
                                onClick={() => setShowBulkAddModal(true)}
                                disabled={!selectedSheet || selectedSheet.isLocked}
                                className={`px-4 py-2 rounded transition shadow-md font-bold text-sm ${!selectedSheet || selectedSheet.isLocked ? 'bg-gray-300 cursor-not-allowed hidden' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                            >
                                Bulk Add
                            </button>
                        )}

                        {section === 'raw_material' && isAdmin && (
                            <button
                                onClick={() => setTransferModal({ isOpen: true })}
                                disabled={!selectedSheet || selectedSheet.isLocked}
                                className={`px-6 py-2 rounded transition shadow-md font-bold ${!selectedSheet || selectedSheet.isLocked ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                            >
                                Transfer
                            </button>
                        )}
                    </div>
                </div>

                {/* Modals */}
                <AddEntryModal
                    isOpen={addEntryModal.isOpen}
                    onClose={() => setAddEntryModal({ isOpen: false, data: undefined })}
                    onSave={handleSaveEntry}
                    section={section}
                    initialData={addEntryModal.data}
                    suppliersList={options.suppliers}
                    warehouses={warehouses}
                />

                <BulkAddEntryModal
                    isOpen={showBulkAddModal}
                    onClose={() => setShowBulkAddModal(false)}
                    onSuccess={() => setShowBulkAddModal(false)}
                    products={productsList || []}
                    suppliers={options.suppliers || []}
                    warehouses={warehouses || []}
                    section={section}
                />

                <TransferModal
                    isOpen={transferModal.isOpen}
                    onClose={() => setTransferModal({ isOpen: false, data: undefined })}
                    onTransfer={handleTransfer}
                    products={productsList}
                    warehouses={warehouses}
                    initialData={transferModal.data}
                />



                <div className="flex-1 bg-gray-50 overflow-hidden p-4">
                    <div className="h-full w-full flex flex-col relative">
                        {loading && (
                            <div className="absolute inset-0 bg-white bg-opacity-70 flex items-center justify-center z-20 rounded-lg">
                                <div className="flex flex-col items-center">
                                    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-2"></div>
                                    <div className="text-blue-600 font-bold">Loading Data...</div>
                                </div>
                            </div>
                        )}

                        {renderError && (
                            <div className="mb-4 p-3 bg-red-100 border border-red-200 text-sm text-red-700 rounded-lg shadow-sm flex items-center gap-2">
                                <span className="font-bold">âš ï¸ ERROR:</span> {renderError}
                            </div>
                        )}

                        <div className="ag-theme-quartz flex-1 shadow-xl rounded-xl overflow-hidden border border-gray-200">
                            <AgGridReact
                                enableCellTextSelection={true}
                                onGridReady={onGridReady}
                                rowData={transactions}
                                columnDefs={columnDefs}
                                quickFilterText={quickFilterText}
                                defaultColDef={{
                                    sortable: true,
                                    filter: true,
                                    resizable: true,
                                    editable: true // Editable by default, but specific cols can override or we can check
                                }}
                                icons={{
                                    sortAscending: `<img src="${sortIcon}" style="width: 14px; height: 14px;"/>`,
                                    sortDescending: `<img src="${sortIcon}" style="width: 14px; height: 14px; transform: rotate(180deg);"/>`,
                                    sortUnSort: `<img src="${sortIcon}" style="width: 14px; height: 14px; opacity: 0.5;"/>`,
                                    menu: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`,
                                    filter: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`
                                }}
                                {...gridStateHandlers}
                                onCellValueChanged={onCellValueChanged}
                                animateRows={true}
                                overlayNoRowsTemplate={selectedSheet ? "No rows found in this sheet." : "Please select or create an inventory sheet."}
                                headerHeight={48}
                                rowHeight={40}
                                getRowStyle={(params) => {
                                    const type = params.data.transaction_type;
                                    const t = params.data.type;

                                    // Finished Goods Styling
                                    if (section === 'finished_goods') {
                                        if (type === 'Sales Order') return { background: '#eff6ff', color: '#1e40af', fontWeight: 'bold' }; // Blue
                                        if (type === 'Manufactured Product') return { background: '#f0fdf4', color: '#166534', fontWeight: 'bold' }; // Green
                                        if (type === 'Delivery Note' || type === 'Sale') return { background: '#fef2f2', color: '#991b1b', fontWeight: 'bold' }; // Red
                                    }

                                    // Raw Material / Generic Styling
                                    if (type === 'Delivery Note') {
                                        return { background: '#bbf7d0', color: '#14532d', fontWeight: 'bold' };
                                    }
                                    if (t === 'Issue' || type === 'Issued' || type === 'Issue') {
                                        return { background: '#fee2e2', color: '#dc2626', fontWeight: 'bold' };
                                    }
                                    if (type === 'Transfer') {
                                        return { background: '#fef08a', color: '#854d0e', fontWeight: 'bold' };
                                    }
                                    return undefined;
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Delete Confirmation Modal */}
            <ConfirmationModal
                isOpen={deleteConfirmation.isOpen}
                title="Delete Transaction"
                message="Are you sure you want to delete this row? This action cannot be undone."
                onConfirm={executeDeleteRow}
                onCancel={() => setDeleteConfirmation({ isOpen: false, rowId: null })}
                confirmText="Delete Row"
                isDangerous={true}
            />

            {/* Delete Sheet Confirmation Modal */}
            {deleteSheetConfirmation.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[150] backdrop-blur-sm">
                    <div className="bg-white p-8 rounded-2xl shadow-2xl w-[480px] animate-in zoom-in-95 duration-200">
                        <div className="flex items-center gap-3 text-red-600 mb-4">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 14c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <h3 className="text-xl font-bold">Delete Inventory Sheet?</h3>
                        </div>

                        <div className="space-y-4 text-gray-600">
                            <p className="font-medium">
                                You are about to delete the sheet for <span className="text-red-600 font-bold">{monthNames[(deleteSheetConfirmation.sheet?.month || 1) - 1]} {deleteSheetConfirmation.sheet?.year}</span>.
                            </p>

                            <div className="bg-red-50 border border-red-100 p-4 rounded-xl text-sm space-y-2">
                                <p className="flex items-start gap-2">
                                    <span className="text-red-600 font-bold">â€¢</span>
                                    <span>All transactions in this sheet will be <strong>permanently deleted</strong>.</span>
                                </p>
                                <p className="flex items-start gap-2">
                                    <span className="text-red-600 font-bold">â€¢</span>
                                    <span>Stock impact of all issues/purchases will be <strong>automatically reversed</strong> in the global inventory.</span>
                                </p>
                                <p className="flex items-start gap-2">
                                    <span className="text-red-600 font-bold">â€¢</span>
                                    <span>Opening stock entries will be removed without affecting global counts.</span>
                                </p>
                            </div>

                            <p className="text-xs italic text-gray-400">
                                Note: This action cannot be undone. Please ensure you have backed up any critical data via "Export Excel" first.
                            </p>
                        </div>

                        <div className="mt-8 flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteSheetConfirmation({ isOpen: false, sheet: null })}
                                className="px-5 py-2 text-gray-500 hover:bg-gray-100 rounded-xl font-bold transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteSheet}
                                disabled={isProcessing}
                                className="px-6 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 font-bold shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {isProcessing ? 'Deleting...' : 'ðŸ—‘ï¸ Delete Everything'}
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {/* General Alert Modal */}
            <ConfirmationModal
                isOpen={stockAlert.isOpen}
                title={stockAlert.title}
                message={stockAlert.message}
                onConfirm={() => setStockAlert({ ...stockAlert, isOpen: false })}
                onCancel={() => setStockAlert({ ...stockAlert, isOpen: false })}
                confirmText="OK"
                hideCancel={true}
            />
        </div>
    )
}