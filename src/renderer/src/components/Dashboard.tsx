import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { CompanySettingsModal } from './CompanySettingsModal'
import { useAuth } from '../context/AuthContext'
import { ConfirmationModal } from './ConfirmationModal'
import { db } from '../firebase'
import { collection, query, where, onSnapshot, orderBy, getDocs, writeBatch, serverTimestamp, doc, updateDoc } from 'firebase/firestore'
import { saveUserLayout, getUserLayout, resetUserLayout } from '../utils/userLayoutService'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import filterIcon from '../assets/filter.png'
import * as XLSX from 'xlsx'
import { useGridState } from '../hooks/useGridState'

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

const formatNumber = (num: any) => {
    const value = typeof num === 'object' && num !== null && 'value' in num ? num.value : num;
    if (value === undefined || value === null) return '';
    const val = Number(value || 0);
    return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// --- Loading Component ---
const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[200] backdrop-blur-sm">
        <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
            <div className="text-gray-700 font-bold text-lg">Processing...</div>
        </div>
    </div>
)

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT: ' + errorMessage)), timeoutMs)
        )
    ]);
};

export const Dashboard: React.FC<{ section?: string }> = ({ section = 'raw_material' }) => {
    const { user } = useAuth()
    const [stats, setStats] = useState({ totalProducts: 0, lowStock: 0 })
    const [quickFilterText, setQuickFilterText] = useState(() => {
        return localStorage.getItem(`dashboard_search_${section}`) || ''
    })
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)

    // Info/Error Modal State
    const [infoModal, setInfoModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'error' | 'success' | 'info';
    }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'info'
    })

    const showInfo = (title: string, message: string, type: 'error' | 'success' | 'info') => {
        setInfoModal({ isOpen: true, title, message, type })
    }
    const [confirmation, setConfirmation] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        isDangerous: boolean;
        action: (() => void) | null;
    }>({
        isOpen: false,
        title: '',
        message: '',
        isDangerous: false,
        action: null
    })

    // Report State
    const [sheets, setSheets] = useState<any[]>([])
    const [selectedDate, setSelectedDate] = useState<{ month: number, year: number } | null>(() => {
        // 1. Try Session Storage
        const saved = sessionStorage.getItem(`dashboard_date_${section}`);
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error("Failed to parse saved date", e);
            }
        }
        // 2. Default to Current Month/Year
        const now = new Date();
        return { month: now.getMonth() + 1, year: now.getFullYear() };
    });
    const [reportData, setReportData] = useState<any[]>([])
    // Stores stock and rate for reports
    const [productsMap, setProductsMap] = useState<Record<string, { stock: number, rate: number, length: number, width: number, gsm: number, uom: string, category_name: string, item_code: string, min_stock_level: number }>>({})
    const [loadingReport, setLoadingReport] = useState(false)
    const [isProcessing, setIsProcessing] = useState(false) // For recalculation overlay
    const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null)

    // Ag-Grid API State
    const [gridApi, setGridApi] = useState<any>(null)
    const [showColManager, setShowColManager] = useState(false)
    // View Mode State
    const [viewMode, setViewMode] = useState<'product' | 'supplier' | 'warehouse' | 'po'>(() => {
        // Optional: Persist viewMode itself? The user didn't ask, but it might be nice. 
        // For now, let's just keep it 'product' by default or latest.
        return 'product';
    })

    const onGridReady = useCallback(async (params: any) => {
        setGridApi(params.api)
        if (user) {
            try {
                const savedState = await getUserLayout(user.uid, `dashboard_${section}_${viewMode}`);
                if (savedState) {
                    params.api.applyColumnState({ state: savedState, applyOrder: true });
                }
            } catch (e) {
                console.error("Failed to load saved layout", e);
            }
        }
    }, [user, section, viewMode])

    const gridStateHandlers = useGridState(`dashboard-${section}-${viewMode}`, gridApi)
    const [stockBreakdown, setStockBreakdown] = useState<{
        suppliers: Record<string, Record<string, number>>;
        warehouses: Record<string, Record<string, number>>;
    }>({ suppliers: {}, warehouses: {} });

    const runDeepDiagnostics = async () => {
        setIsProcessing(true);
        console.log("--- Starting Deep Diagnostics ---");
        const W1_CORRECT = '3yEbnDm5QXEbLVZVFrCd';
        const W2_CORRECT = 'Ppiu8bhYDu9wQmQCCKbl';

        const { collection, getDocs, doc, updateDoc } = await import("firebase/firestore");

        try {
            const wSnap = await getDocs(collection(db, 'warehouses'));
            const validIds = new Set(wSnap.docs.map(d => d.id));
            console.log("Valid Warehouse IDs:", Array.from(validIds));

            const transSnap = await getDocs(collection(db, "rm_inventory_transactions"));
            const orphans: any[] = [];

            transSnap.forEach(d => {
                const t = d.data();
                const fields = ['warehouse_id', 'source_warehouse_id', 'dest_warehouse_id'];
                fields.forEach(f => {
                    const id = t[f];
                    if (id && !validIds.has(id)) {
                        orphans.push({ docId: d.id, field: f, ghostId: id, name: t.warehouse_name || t.source_warehouse_name || t.dest_warehouse_name || 'Unknown', type: t.transaction_type, prod: t.product_name });
                    }
                });
            });

            console.log("Orphaned Transactions Found:", orphans);
            if (orphans.length === 0) {
                alert("No orphaned transactions found! Everything looks clean.");
            } else {
                const summary = orphans.slice(0, 10).map(o => `${o.prod} (${o.ghostId}) -> Name: ${o.name}`).join('\n');
                if (window.confirm(`Found ${orphans.length} orphaned transaction fields.\n\nFirst few:\n${summary}\n\nShould I attempt to auto-repair these based on their names?`)) {
                    let fixed = 0;
                    for (const o of orphans) {
                            let corrId = null;
                            if (o.ghostId === 'bZR73v1wwSnaonJPmwJV' || o.ghostId === 'fOhZzsZmB0Tr3TQsLUYt') {
                                corrId = W1_CORRECT;
                            } else if (o.name.includes("1")) {
                                corrId = W1_CORRECT;
                            } else if (o.name.includes("2")) {
                                corrId = W2_CORRECT;
                            }
                            
                            if (corrId) {
                                await updateDoc(doc(db, "rm_inventory_transactions", o.docId), { [o.field]: corrId });
                                fixed++;
                            }
                    }
                    alert(`Repaired ${fixed} / ${orphans.length} orphans. For those with 'Unknown' names, you might need to check them manually in the console.`);
                    executeRecalculateStock();
                }
            }
        } catch (e: any) {
            console.error(e);
            alert("Error: " + e.message);
        } finally {
            setIsProcessing(false);
        }
    }

    const confirmRecalculateStock = () => {
        setConfirmation({
            isOpen: true,
            title: 'Recalculate Stock',
            message: 'Are you sure? This will recalculate stock based on ALL transactions. This process might take a few seconds.',
            isDangerous: false,
            action: executeRecalculateStock
        })
    }

    const executeRecalculateStock = async () => {
        setIsProcessing(true);
        setConfirmation(prev => ({ ...prev, isOpen: false })); // Close confirmation immediately

        try {
            console.log("Starting Stock Recalculation...");
            const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
            const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';

            // 1. Fetch ALL transactions and warehouses
            const [transSnapshot, warehousesSnap] = await Promise.all([
                withTimeout(getDocs(collection(db, transCollName)), 60000, "Fetching transactions took too long"),
                getDocs(collection(db, 'warehouses'))
            ]);

            // Build Warehouse Name Map and Canonical ID Map
            const idToName: Record<string, string> = {};
            const nameToCanonicalId: Record<string, string> = {};

            warehousesSnap.docs.forEach(d => {
                const w = d.data();
                const name = w.name;
                idToName[d.id] = name;
                if (!nameToCanonicalId[name]) {
                    nameToCanonicalId[name] = d.id;
                }
            });

            console.log(`Fetched ${transSnapshot.size} transactions and ${warehousesSnap.size} warehouse records.`);

            // 2. Aggregate Stock per Product, Supplier, and Warehouse
            const globalStockMap: Record<string, number> = {};
            const supplierStockMap: Record<string, Record<string, number>> = {}; // { pid: { supplierName: stock } }
            const warehouseStockMap: Record<string, Record<string, number>> = {}; // { pid: { warehouseId: stock } }

            transSnapshot.forEach(doc => {
                const t = doc.data();
                // SKIP carry-forwards ONLY if they are NOT 'Opening' transactions.
                if (t.is_carry_forward === true && t.transaction_type !== 'Opening') return;

                const pid = t.product_id;
                if (!pid) return;

                const qty = Number(t.quantity || 0);

                // Smart Warehouse ID Resolver: Use the name logic to find the canonical ID
                let wId = t.warehouse_id;
                if (wId) {
                    const wName = t.warehouse_name || idToName[wId];
                    if (wName && nameToCanonicalId[wName]) {
                        wId = nameToCanonicalId[wName];
                    }
                }

                if (t.transaction_type === 'Transfer') {
                    // Global Stock: Net effect 0
                    if (!globalStockMap[pid]) globalStockMap[pid] = 0;

                    // Warehouse Stock: Shuffle between source and dest
                    if (t.source_warehouse_id) {
                        const sName = t.source_warehouse_name || idToName[t.source_warehouse_id];
                        const sId = (sName && nameToCanonicalId[sName]) || t.source_warehouse_id;
                        if (!warehouseStockMap[pid]) warehouseStockMap[pid] = {};
                        if (!warehouseStockMap[pid][sId]) warehouseStockMap[pid][sId] = 0;
                        warehouseStockMap[pid][sId] -= qty;
                    }
                    if (t.dest_warehouse_id) {
                        const dName = t.dest_warehouse_name || idToName[t.dest_warehouse_id];
                        const dId = (dName && nameToCanonicalId[dName]) || t.dest_warehouse_id;
                        if (!warehouseStockMap[pid]) warehouseStockMap[pid] = {};
                        if (!warehouseStockMap[pid][dId]) warehouseStockMap[pid][dId] = 0;
                        warehouseStockMap[pid][dId] += qty;
                    }
                    return;
                }

                // Global
                if (!globalStockMap[pid]) globalStockMap[pid] = 0;
                globalStockMap[pid] += qty;

                // Supplier
                const sName = (t.manual_supplier_name || t.supplier_name);
                if (sName) {
                    if (!supplierStockMap[pid]) supplierStockMap[pid] = {};
                    if (!supplierStockMap[pid][sName]) supplierStockMap[pid][sName] = 0;
                    supplierStockMap[pid][sName] += qty;
                }

                // Warehouse
                if (wId) {
                    if (!warehouseStockMap[pid]) warehouseStockMap[pid] = {};
                    if (!warehouseStockMap[pid][wId]) warehouseStockMap[pid][wId] = 0;
                    warehouseStockMap[pid][wId] += qty;
                }
            });

            // 3. Perform Updates using Batched Writes
            const allPids = Array.from(new Set([
                ...Object.keys(globalStockMap),
                ...Object.keys(supplierStockMap),
                ...Object.keys(warehouseStockMap)
            ])).filter(pid => productsMap[pid]); // Only update products that still exist

            console.log(`Updating stock for ${allPids.length} products...`);

            let batch = writeBatch(db);
            let opCount = 0;

            const commitBatch = async () => {
                if (opCount > 0) {
                    await withTimeout(batch.commit(), 60000, "Committing batch took too long");
                    batch = writeBatch(db);
                    opCount = 0;
                }
            };

            for (const pid of allPids) {
                // Global update
                const prodRef = doc(db, prodCollName, pid);
                batch.update(prodRef, {
                    current_stock: globalStockMap[pid] || 0,
                    updatedAt: serverTimestamp()
                });
                opCount++;
                if (opCount >= 400) await commitBatch();

                // Supplier updates
                const suppliers = supplierStockMap[pid] || {};
                for (const [sName, sQty] of Object.entries(suppliers)) {
                    const sRef = doc(db, prodCollName, pid, 'supplier_stock', sName);
                    batch.set(sRef, {
                        current_stock: sQty,
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                    opCount++;
                    if (opCount >= 400) await commitBatch();
                }

                // Warehouse updates
                const warehouses = warehouseStockMap[pid] || {};
                for (const [wId, wQty] of Object.entries(warehouses)) {
                    const wRef = doc(db, prodCollName, pid, 'warehouse_stock', wId);
                    batch.set(wRef, {
                        current_stock: wQty,
                        updatedAt: serverTimestamp()
                    }, { merge: true });
                    opCount++;
                    if (opCount >= 400) await commitBatch();
                }
            }

            await commitBatch(); // Last commit
            console.log("Stock Recalculated Successfully");
            showInfo('Success', 'Stock levels have been synchronized based on transaction history.', 'success');
        } catch (error: any) {
            console.error("Recalculation Failed:", error);
            let msg = error.message;
            if (msg?.includes('TIMEOUT')) {
                msg = "Operation Timed Out. Firestore is responding too slowly (likely quota limits). Please try again later.";
            }
            showInfo('Error', 'Failed to recalculate stock: ' + msg, 'error');
        } finally {
            setIsProcessing(false);
        }
    }

    // 1. Dashboard Stats (Total Products & Low Stock)
    useEffect(() => {
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
        const q = collection(db, prodCollName);
        const unsubscribe = onSnapshot(q, (snapshot) => {
            let totalProducts = 0;
            let lowStock = 0;
            // Updated Type Definition to include category_name and min_stock_level
            const pMap: Record<string, { stock: number, rate: number, length: number, width: number, gsm: number, uom: string, category_name: string, item_code: string, min_stock_level: number }> = {};

            snapshot.forEach(doc => {
                const data = doc.data();
                totalProducts++;
                const stock = Number(data.current_stock || 0);
                const min = Number(data.min_stock_level || 0);
                if (stock <= min) {
                    lowStock++;
                }
                // Map for report sorting & display (Store Stock and Rate)
                pMap[doc.id] = {
                    stock,
                    rate: Number(data.rate || 0),
                    length: Number(data.length || 0),
                    width: Number(data.width || 0),
                    gsm: Number(data.gsm || 0),
                    uom: data.uom || '',
                    category_name: data.category_name || '',
                    item_code: data.item_code || '',
                    min_stock_level: min
                };
            });
            setStats({ totalProducts, lowStock });
            setProductsMap(pMap);
        });

        return () => unsubscribe();
    }, [section]);

    // Sync search text when section changes
    useEffect(() => {
        setQuickFilterText(localStorage.getItem(`dashboard_search_${section}`) || '');
    }, [section]);

    // 2. Fetch Sheets (Listener) & Warehouses
    const [warehousesMap, setWarehousesMap] = useState<Record<string, string>>({});

    useEffect(() => {
        // Fetch Warehouses for ID lookup
        const fetchWarehouses = async () => {
            try {
                const wSnap = await getDocs(collection(db, 'warehouses'));
                const wMap: Record<string, string> = {};
                wSnap.forEach(doc => {
                    wMap[doc.id] = doc.data().name;
                });
                setWarehousesMap(wMap);
            } catch (error) {
                console.error("Error fetching warehouses:", error);
            }
        };
        fetchWarehouses();

        const sheetsCollName = section === 'finished_goods' ? 'fg_inventory_sheets' : 'rm_inventory_sheets';
        const q = query(
            collection(db, sheetsCollName),
            orderBy('year', 'desc'),
            orderBy('month', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as any[];
            setSheets(data);
            console.log(`[Dashboard] ${section} Sheets loaded:`, data.length);

            // Validate selectedDate
            if (data.length > 0) {
                const latest = data[0]; // Assuming sorted desc by year/month
                if (!selectedDate) {
                    console.log("[Dashboard] Initializing date to latest sheet:", latest.id);
                    setSelectedDate({ month: latest.month, year: latest.year });
                } else {
                    // Check if current selectedDate exists in sheets
                    const exists = data.some(s => s.month === selectedDate.month && s.year === selectedDate.year);
                    // Also check if YEAR exists, if not, we must switch year
                    const yearExists = data.some(s => s.year === selectedDate.year);

                    if (!exists) {
                        // If exact match doesn't exist, try to keep year if possible, else switch to latest
                        if (yearExists) {
                            // Year exists, but month doesn't. Find a valid month in this year?
                            const sheetInYear = data.find(s => s.year === selectedDate.year);
                            if (sheetInYear) {
                                console.log("[Dashboard] Month not found, switching to available month in year:", sheetInYear.month);
                                setSelectedDate({ month: sheetInYear.month, year: sheetInYear.year });
                            }
                        } else {
                            // Year doesn't exist, switch to latest
                            console.log("[Dashboard] Selected date invalid, switching to latest:", latest.id);
                            setSelectedDate({ month: latest.month, year: latest.year });
                        }
                    }
                }
            } else {
                // No sheets at all
                console.log("[Dashboard] No sheets found.");
            }
        });

        return () => unsubscribe();
    }, [section, selectedDate]); // Added selectedDate to dependencies

    // 3. Update Selected Sheet ID when Date Changes
    useEffect(() => {
        if (!selectedDate) return;
        const sheet = sheets.find(s => s.month === selectedDate.month && s.year === selectedDate.year);
        console.log(`[Dashboard] Selected Date: ${selectedDate.month}/${selectedDate.year} -> Sheet ID: ${sheet?.id}`);
        setSelectedSheetId(sheet ? sheet.id : null);
    }, [selectedDate, sheets, section]);

    const [transactions, setTransactions] = useState<any[]>([]);

    // 4. Fetch ALL Transactions (to calculate Opening correctly)
    useEffect(() => {
        setLoadingReport(true);
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
        const q = collection(db, transCollName);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const trans = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            console.log(`[Dashboard] Fetched ${trans.length} transactions total`);
            setTransactions(trans);
        });

        return () => unsubscribe();
    }, [section]);

    // 5. Fetch Stock Breakdown
    useEffect(() => {
        const fetchBreakdown = async () => {
            if (viewMode === 'product' || transactions.length === 0) {
                setStockBreakdown({ suppliers: {}, warehouses: {} });
                return;
            }

            const uniquePids = Array.from(new Set(transactions.map(t => t.product_id).filter(Boolean)));
            if (uniquePids.length === 0) return;

            const breakdown: Record<string, Record<string, number>> = {};
            const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
            const subCollName = viewMode === 'supplier' ? 'supplier_stock' : 'warehouse_stock';

            await Promise.all(uniquePids.map(async (pid) => {
                const subRef = collection(db, prodCollName, pid, subCollName);
                const snap = await getDocs(subRef);
                breakdown[pid] = {};
                snap.forEach(doc => {
                    breakdown[pid][doc.id] = doc.data().current_stock || 0;
                });
            }));

            setStockBreakdown(prev => ({
                ...prev,
                [viewMode === 'supplier' ? 'suppliers' : 'warehouses']: breakdown
            }));
        };

        fetchBreakdown();
    }, [viewMode, transactions, section]);

    // 6. Aggregate Report Data
    useEffect(() => {
        if (transactions.length === 0 || !selectedSheetId || sheets.length === 0) {
            setReportData([]);
            setLoadingReport(false);
            return;
        }

        setLoadingReport(true);
        const selectedSheet = sheets.find(s => s.id === selectedSheetId);
        if (!selectedSheet) {
            setLoadingReport(false);
            return;
        }

        const aggMap: Record<string, any> = {};

        transactions.forEach((t: any) => {
            const rawName = (t.manual_product_name || t.product_name || '');
            const productName = rawName.toUpperCase().trim();
            if (!productName) return;

            const tSheet = sheets.find(s => s.id === t.sheet_id);
            const isPrevious = tSheet && (
                (tSheet.year < selectedSheet.year) ||
                (tSheet.year === selectedSheet.year && tSheet.month < selectedSheet.month)
            );
            const isCurrent = t.sheet_id === selectedSheetId;

            if (!isPrevious && !isCurrent) return;

            let key = productName;
            if (section === 'finished_goods') {
                if (viewMode !== 'product') {
                    const po = (t.po_no || 'No PO').toUpperCase().trim();
                    key = `${po}_${productName}`;
                }
            } else {
                if (viewMode === 'supplier') {
                    const supplier = (t.manual_supplier_name || t.supplier_name || 'Unknown').toUpperCase().trim();
                    key = `${productName}|${supplier}`;
                }
            }

            if (!aggMap[key]) {
                aggMap[key] = {
                    ...t,
                    product_ids: new Set(),
                    product_name: rawName,
                    category_name: t.manual_category_name || t.category_name || '',
                    displaySupplier: (viewMode === 'supplier' || section === 'finished_goods') ? (t.manual_supplier_name || t.supplier_name || t.customer_name) : null,
                    opening_qty: 0,
                    monthly_inward: 0,
                    monthly_outward: 0,
                    monthly_kg: 0,
                    monthly_amount: 0,
                    warehouse_breakdown: {} as Record<string, { opening: number, inward: number, outward: number, kg: number, amount: number }>,
                    po_no: t.po_no || 'No PO',
                    product_id: t.product_id || '',
                    customer: t.manual_supplier_name || t.customer_name || t.supplier_name,
                    category: t.manual_category_name || t.category_name,
                    item_code: t.item_code || '',
                    so_qty: 0,
                    tolerance: 0,
                    prod_qty: 0,
                    dispatch_qty: 0
                };
            }

            const item = aggMap[key];
            const qty = Number(t.quantity || 0);
            const kg = Number(t.calculated_kgs || 0);

            if (t.product_id) item.product_ids.add(t.product_id);
            if (!item.product_id && t.product_id) item.product_id = t.product_id;
            if (!item.item_code && t.item_code) item.item_code = t.item_code;
            if (!item.item_code && item.product_id) {
                item.item_code = productsMap[item.product_id]?.item_code || '';
            }

            const type = t.transaction_type;
            const isInward = ['Purchase', 'Purchased', 'Return To Store', 'Return', 'Opening', 'Manufactured Product'].includes(type) || (type === 'Adjustment' && qty > 0);
            const isOutward = ['Issue', 'Issued', 'Delivery Note', 'Sale'].includes(type) || (type === 'Adjustment' && qty < 0);

            if (isPrevious) {
                if (type === 'Transfer') {
                    if (t.source_warehouse_id) {
                        const sId = t.source_warehouse_id;
                        if (!item.warehouse_breakdown[sId]) item.warehouse_breakdown[sId] = { opening: 0, inward: 0, outward: 0, kg: 0, amount: 0 };
                        item.warehouse_breakdown[sId].opening -= Math.abs(qty);
                    }
                    if (t.dest_warehouse_id) {
                        const dId = t.dest_warehouse_id;
                        if (!item.warehouse_breakdown[dId]) item.warehouse_breakdown[dId] = { opening: 0, inward: 0, outward: 0, kg: 0, amount: 0 };
                        item.warehouse_breakdown[dId].opening += Math.abs(qty);
                    }
                } else {
                    let change = 0;
                    if (isInward) change = Math.abs(qty);
                    else if (isOutward) change = -Math.abs(qty);

                    item.opening_qty += change;
                    if (t.warehouse_id) {
                        if (!item.warehouse_breakdown[t.warehouse_id]) item.warehouse_breakdown[t.warehouse_id] = { opening: 0, inward: 0, outward: 0, kg: 0, amount: 0 };
                        item.warehouse_breakdown[t.warehouse_id].opening += change;
                    }
                }
                return;
            }

            // --- Current Sheet Logic ---
            if (type === 'Transfer') {
                if (viewMode === 'warehouse') {
                    if (t.source_warehouse_id) {
                        const sId = t.source_warehouse_id;
                        if (!item.warehouse_breakdown[sId]) item.warehouse_breakdown[sId] = { opening: 0, inward: 0, outward: 0, kg: 0, amount: 0 };
                        item.warehouse_breakdown[sId].outward += Math.abs(qty);
                    }
                    if (t.dest_warehouse_id) {
                        const dId = t.dest_warehouse_id;
                        if (!item.warehouse_breakdown[dId]) item.warehouse_breakdown[dId] = { opening: 0, inward: 0, outward: 0, kg: 0, amount: 0 };
                        item.warehouse_breakdown[dId].inward += Math.abs(qty);
                    }
                }
                return;
            }

            if (type === 'Opening') {
                item.opening_qty += qty;
                if (t.warehouse_id) {
                    if (!item.warehouse_breakdown[t.warehouse_id]) item.warehouse_breakdown[t.warehouse_id] = { opening: 0, inward: 0, outward: 0, kg: 0, amount: 0 };
                    item.warehouse_breakdown[t.warehouse_id].opening += qty;
                }
                return;
            }

            if (section === 'finished_goods') {
                if (type === 'Sales Order') {
                    item.so_qty += (t.display_quantity || 0);
                    item.tolerance += (t.tolerance || 0);
                } else if (type === 'Manufactured Product') {
                    item.prod_qty += qty;
                    item.monthly_inward += qty;
                } else if (['Delivery Note', 'Sale', 'Issue'].includes(type)) {
                    item.dispatch_qty += Math.abs(qty);
                    item.monthly_outward += Math.abs(qty);
                } else if (type === 'Return') {
                    item.monthly_inward += Math.abs(qty);
                } else if (type === 'Adjustment') {
                    if (qty > 0) item.monthly_inward += qty;
                    else item.monthly_outward += Math.abs(qty);
                }
                item.monthly_kg += kg;
            } else {
                if (isInward) item.monthly_inward += Math.abs(qty);
                else if (isOutward) item.monthly_outward += Math.abs(qty);

                if (viewMode === 'warehouse' && t.warehouse_id) {
                    if (!item.warehouse_breakdown[t.warehouse_id]) item.warehouse_breakdown[t.warehouse_id] = { opening: 0, inward: 0, outward: 0, kg: 0, amount: 0 };
                    const wb = item.warehouse_breakdown[t.warehouse_id];
                    if (isInward) wb.inward += Math.abs(qty);
                    else if (isOutward) wb.outward += Math.abs(qty);
                }
            }
        });

        let processed = Object.values(aggMap).flatMap((item: any) => {
            if (section === 'finished_goods') return item;

            const pids = Array.from(item.product_ids) as string[];
            const refProduct = pids.length > 0 ? productsMap[pids[0]] : null;
            const rate = refProduct ? refProduct.rate : 0;
            const L = refProduct ? refProduct.length : 0;
            const W = refProduct ? refProduct.width : 0;
            const G = refProduct ? refProduct.gsm : 0;
            const uom = refProduct ? refProduct.uom : '';
            const cat = refProduct ? refProduct.category_name : '';
            const min = refProduct ? refProduct.min_stock_level : 0;

            const createRow = (inward: number, outward: number, opening: number, extraProps: any = {}) => {
                const calculatedStock = opening + inward - outward;
                let calculatedKg = 0;
                if (L && W && G) calculatedKg = ((L * 25.4 / 1000) * (W * 25.4 / 1000) * (G / 1000)) * calculatedStock;
                const finalKg = Number(calculatedKg.toFixed(2));
                const stockAmount = (cat?.toUpperCase() === 'PAPER & BOARD') ? (finalKg * rate) : (calculatedStock * rate);

                return {
                    ...item,
                    ...extraProps,
                    category_name: cat,
                    uom: uom,
                    opening_balance: opening,
                    monthly_inward: inward,
                    monthly_outward: outward,
                    monthly_kg: finalKg,
                    monthly_amount: stockAmount,
                    currentStock: calculatedStock,
                    displayQuantity: calculatedStock,
                    displayAmount: stockAmount,
                    rate: rate,
                    length: L, width: W, gsm: G,
                    min_stock_level: min
                };
            };

            if (viewMode === 'warehouse') {
                const rows: any[] = [];
                Object.entries(item.warehouse_breakdown || {}).forEach(([wId, stats]: [string, any]) => {
                    const wName = warehousesMap[wId] || wId;
                    rows.push(createRow(stats.inward, stats.outward, stats.opening, { warehouse_name: wName }));
                });
                return rows.length === 0 ? [createRow(0, 0, 0, { warehouse_name: 'No Activity' })] : rows;
            }

            if (viewMode === 'supplier') {
                return [createRow(item.monthly_inward, item.monthly_outward, item.opening_qty)];
            }

            return [createRow(item.monthly_inward, item.monthly_outward, item.opening_qty)];
        });

        processed.sort((a: any, b: any) => {
            const aLow = (a.currentStock <= a.min_stock_level && a.min_stock_level > 0);
            const bLow = (b.currentStock <= b.min_stock_level && b.min_stock_level > 0);

            if (aLow && !bLow) return -1;
            if (!aLow && bLow) return 1;
            return (a.product_name || '').localeCompare(b.product_name || '');
        });

        setReportData(processed);
        setLoadingReport(false);

    }, [transactions, productsMap, stockBreakdown, viewMode, section, selectedSheetId, sheets, warehousesMap]);

    /* 
    // OLD EFFECT REMOVED via replacement
    */

    // Ag-Grid Columns
    const columnDefs = useMemo(() => {
        if (section === 'finished_goods') {
            const commonCols = [
                { field: 'category', headerName: 'Category', width: 120, filter: true },
                { field: 'customer', headerName: 'Customer', width: 150, filter: true },
                { field: 'product_name', headerName: 'Product', width: 250, filter: true },
                { field: 'item_code', headerName: 'Item Code', width: 100, filter: true },
                { field: 'so_qty', headerName: 'SO Qty', width: 100, type: 'numericColumn', valueFormatter: formatNumber, aggFunc: 'sum' },
                { field: 'prod_qty', headerName: 'Prod Qty', width: 100, type: 'numericColumn', valueFormatter: formatNumber, aggFunc: 'sum' },
                { field: 'dispatch_qty', headerName: 'Dispatch Qty', width: 100, type: 'numericColumn', valueFormatter: formatNumber, aggFunc: 'sum' },
                { field: 'monthly_kg', headerName: 'Kg', width: 100, type: 'numericColumn', valueFormatter: formatNumber },
                {
                    headerName: 'Pending Qty',
                    width: 120,
                    type: 'numericColumn',
                    valueGetter: (p: any) => {
                        const so = p.data?.so_qty || 0;
                        const dsp = p.data?.dispatch_qty || 0;
                        const tol = p.data?.tolerance || 0;
                        const pQty = so - dsp;
                        if (pQty < 0) return tol + pQty;
                        return pQty;
                    },
                    valueFormatter: formatNumber,
                    cellStyle: (p: any) => {
                        const so = p.data?.so_qty || 0;
                        const dsp = p.data?.dispatch_qty || 0;
                        return (so - dsp < 0) ? { fontWeight: 'bold', color: '#dc2626' } : { fontWeight: 'bold', color: '#ea580c' };
                    }
                },
            ];

            if (viewMode === 'product') {
                return [
                    ...commonCols,
                    {
                        headerName: 'Available Stock',
                        width: 120,
                        valueGetter: (p: any) => (p.data.prod_qty - p.data.dispatch_qty),
                        valueFormatter: formatNumber,
                        type: 'numericColumn',
                        cellStyle: (p: any) => p.value < 0 ? { color: 'red', fontWeight: 'bold' } : { color: 'green', fontWeight: 'bold' }
                    }
                ];
            } else {
                return [
                    { field: 'po_no', headerName: 'PO No.', width: 120, filter: true },
                    ...commonCols
                ];
            }
        }

        const baseCols = [
            { field: 'category_name', headerName: 'Item Category', flex: 1 },
            {
                field: 'product_name',
                headerName: 'Item Description',
                flex: 2,
                cellRenderer: (params: any) => {
                    const isLow = params.data.currentStock <= params.data.min_stock_level && params.data.min_stock_level > 0;
                    return (
                        <div className="flex items-center gap-2">
                            {params.value}
                            {isLow && (
                                <span className="text-xs font-bold text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full border border-orange-200">
                                    Low Stock (Min: {params.data.min_stock_level})
                                </span>
                            )}
                        </div>
                    );
                }
            },
            {
                field: 'opening_balance',
                headerName: 'Opening Balance',
                width: 140,
                valueFormatter: formatNumber,
                type: 'numericColumn',
                cellStyle: { color: '#64748b', fontStyle: 'italic' }
            },
            {
                field: 'monthly_inward',
                headerName: 'Received',
                width: 130,
                valueFormatter: formatNumber,
                type: 'numericColumn'
            },
            {
                field: 'monthly_outward',
                headerName: 'Issued',
                width: 130,
                valueFormatter: formatNumber,
                type: 'numericColumn'
            },
            {
                field: 'displayQuantity',
                headerName: 'Available Stock',
                width: 150,
                valueFormatter: (p: any) => formatNumber(p.value),
                cellStyle: (params: any) => {
                    const isLow = params.data.currentStock <= params.data.min_stock_level && params.data.min_stock_level > 0;
                    if (isLow) return { color: '#ea100c', fontWeight: 'bold' };
                    if (params.value < 0) return { color: 'red', fontWeight: 'bold' };
                    return { color: '#16a34a', fontWeight: 'bold' };
                }
            }
        ];

        const rmCols = [
            { field: 'length', headerName: 'L', width: 80 },
            { field: 'width', headerName: 'W', width: 80 },
            { field: 'gsm', headerName: 'G', width: 80 },
            { field: 'uom', headerName: 'UOM', width: 80 },
            { field: 'monthly_kg', headerName: 'Kg', width: 100, valueFormatter: formatNumber, type: 'numericColumn' },
            { field: 'rate', headerName: 'Rate', width: 100, valueFormatter: formatNumber },
            {
                colId: 'total_amount',
                headerName: 'Total Amount',
                width: 120,
                valueGetter: (params: any) => params.data.monthly_amount || 0,
                valueFormatter: formatNumber,
                cellStyle: (params: any) => (params.value < 0) ? { color: 'red', fontWeight: 'bold' } : null
            }
        ];

        const extraCol = [];
        if (viewMode === 'supplier') extraCol.push({ field: 'displaySupplier', headerName: 'Supplier', width: 150, pinned: 'left' });
        if (viewMode === 'warehouse') extraCol.push({ field: 'warehouse_name', headerName: 'Warehouse', width: 150, pinned: 'left' });

        return [
            baseCols[0], baseCols[1], ...extraCol,
            rmCols[0], rmCols[1], rmCols[2], rmCols[3],
            baseCols[2], baseCols[3], baseCols[4], rmCols[4],
            baseCols[5], rmCols[5], rmCols[6]
        ];
    }, [section, viewMode]);

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
        XLSX.utils.book_append_sheet(workbook, worksheet, "DashboardReport");
        const fileName = `DashboardReport_${selectedDate ? `${monthNames[selectedDate.month - 1]}_${selectedDate.year}` : 'Export'}.xlsx`;
        XLSX.writeFile(workbook, fileName);
    }, [gridApi, selectedDate]);

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    return (
        <div className="p-4 h-[calc(100vh-120px)] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-6 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold">Dashboard</h2>
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 border border-green-200 rounded-full">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Live Sync</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Run Deep Diagnostics button hidden — uncomment when needed
                    <button onClick={runDeepDiagnostics} className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 font-bold shadow-sm transition-all">
                        Run Deep Diagnostics
                    </button>
                    */}
                    <button onClick={() => setIsSettingsOpen(true)} className="bg-gray-800 text-white px-4 py-2 rounded hover:bg-gray-700 flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Company Details
                    </button>
                </div>
            </div>

            <div className="flex justify-between items-center mb-6">
                <div className="relative">
                    <input
                        type="text"
                        placeholder="Search dashboard..."
                        className="pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all w-64"
                        value={quickFilterText}
                        onChange={(e) => {
                            const val = e.target.value;
                            setQuickFilterText(val);
                            localStorage.setItem(`dashboard_search_${section}`, val);
                        }}
                    />
                    {quickFilterText && (
                        <button onClick={() => { setQuickFilterText(''); localStorage.setItem(`dashboard_search_${section}`, ''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    )}
                    <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                </div>
            </div>

            <div className="flex justify-between items-center mb-2">
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    {section === 'finished_goods' ? (
                        <>
                            <button onClick={() => setViewMode('product')} className={`px-4 py-2 rounded-md text-sm font-medium capitalize transition-all ${viewMode === 'product' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Product Wise</button>
                            <button onClick={() => setViewMode('po')} className={`px-4 py-2 rounded-md text-sm font-medium capitalize transition-all ${viewMode === 'po' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>PO Wise</button>
                        </>
                    ) : (
                        ['product', 'supplier', 'warehouse'].map((mode) => (
                            <button key={mode} onClick={() => setViewMode(mode as any)} className={`px-4 py-2 rounded-md text-sm font-medium capitalize transition-all ${viewMode === mode ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                {mode} Wise
                            </button>
                        ))
                    )}
                </div>
                {(user?.role === 'admin' || (user?.role === 'po_officer' && section === 'raw_material')) && (
                    <button onClick={confirmRecalculateStock} className="text-blue-600 hover:text-blue-800 text-sm font-bold flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Recalculate Stock
                    </button>
                )}
            </div>

            <div className="flex-1 flex flex-col min-h-0 bg-white rounded-lg shadow p-4 h-full">
                <div className="flex justify-between items-center mb-4 flex-shrink-0">
                    <h3 className="text-lg font-bold text-gray-800">Monthly Report</h3>
                    <div className="flex gap-4 relative">
                        <button onClick={handleExport} className="px-4 py-2 rounded transition shadow-sm font-bold border bg-white text-green-700 hover:bg-green-50 border-green-200 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            Export Excel
                        </button>
                        <div className="relative">
                            <button onClick={() => setShowColManager(!showColManager)} className={`px-4 py-2 rounded transition shadow-sm font-bold border flex items-center gap-2 ${showColManager ? 'bg-gray-200 text-gray-800' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v18h-6M10 17l5-5-5-5M3 13v6M3 5v6" /></svg>
                                Columns
                            </button>
                            {showColManager && gridApi && <ColumnManager api={gridApi} onClose={() => setShowColManager(false)} gridId={`dashboard_${section}_${viewMode}`} />}
                        </div>
                        <select className="border rounded p-2" value={selectedDate?.year} onChange={(e) => setSelectedDate({ month: selectedDate?.month || 1, year: Number(e.target.value) })}>
                            {Array.from(new Set(sheets.map(s => s.year))).sort((a, b) => b - a).map(y => <option key={y} value={y}>{y}</option>)}
                        </select>
                        <select className="border rounded p-2" value={selectedDate?.month} onChange={(e) => setSelectedDate({ year: selectedDate?.year || new Date().getFullYear(), month: Number(e.target.value) })}>
                            {sheets.filter(s => s.year === (selectedDate?.year || sheets[0]?.year)).map(s => <option key={s.id} value={s.month}>{monthNames[s.month - 1]}</option>)}
                        </select>
                    </div>
                </div>

                <div className="flex-1 w-full h-full">
                    {loadingReport ? <div className="flex items-center justify-center h-full text-gray-500">Loading Report...</div> :
                        reportData.length === 0 ? <div className="flex items-center justify-center h-full text-gray-500">No data found for selected month.</div> : (
                            <div className="ag-theme-alpine h-full w-full">
                                <AgGridReact
                                    enableCellTextSelection={true}
                                    onGridReady={onGridReady}
                                    rowData={reportData}
                                    columnDefs={columnDefs}
                                    quickFilterText={quickFilterText}
                                    defaultColDef={{ sortable: true, filter: true, resizable: true }}
                                    icons={{
                                        menu: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`,
                                        filter: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`
                                    }}
                                    {...gridStateHandlers}
                                    rowHeight={40}
                                    headerHeight={48}
                                />
                            </div>
                        )}
                </div>
            </div>

            {isProcessing && <LoadingOverlay />}
            <CompanySettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
            <ConfirmationModal isOpen={confirmation.isOpen} title={confirmation.title} message={confirmation.message} isDangerous={confirmation.isDangerous} onConfirm={confirmation.action || (() => { })} onCancel={() => setConfirmation(prev => ({ ...prev, isOpen: false }))} confirmText="Confirm" />
            <ConfirmationModal isOpen={infoModal.isOpen} title={infoModal.title} message={infoModal.message} isDangerous={infoModal.type === 'error'} onConfirm={() => setInfoModal(prev => ({ ...prev, isOpen: false }))} onCancel={() => setInfoModal(prev => ({ ...prev, isOpen: false }))} confirmText="OK" cancelText="Close" />
        </div>
    )
}
