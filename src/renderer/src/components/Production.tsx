import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, query, where, orderBy, getDocs, writeBatch, doc, increment, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { saveUserLayout, getUserLayout, resetUserLayout } from '../utils/userLayoutService'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import { useGridState } from '../hooks/useGridState'
import { AddProductionModal } from './AddProductionModal'
import { BulkProductionModal } from './BulkProductionModal'
import { ConfirmationModal } from './ConfirmationModal'
import editIcon from '../assets/edit.png'
import deleteIcon from '../assets/delete.png'
import filterIcon from '../assets/filter.png'

// --- Helper Functions ---
const formatNumber = (params: any) => {
    const value = typeof params === 'object' && params !== null && 'value' in params ? params.value : params;
    if (value === undefined || value === null || value === '') return '';
    const val = Number(value);
    if (isNaN(val)) return value;
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

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
]

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
                {columns.filter(c => c.headerName !== '' && c.id !== '0' && c.id !== 'actions').map(col => (
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

export const Production: React.FC = () => {
    // State
    const { user } = useAuth()
    const canEdit = user?.role === 'admin' || user?.role === 'production_officer' || user?.role === 'delivery_officer'

    const [sheets, setSheets] = useState<any[]>([])
    const [selectedSheet, setSelectedSheet] = useState<any>(null)
    const [rowData, setRowData] = useState<any[]>([])
    const [productsMap, setProductsMap] = useState<Map<string, any>>(new Map())

    // Ag-Grid API State
    const [gridApi, setGridApi] = useState<any>(null)
    const [showColManager, setShowColManager] = useState(false)
    const onGridReady = React.useCallback(async (params: any) => {
        setGridApi(params.api)
        if (user) {
            try {
                const savedState = await getUserLayout(user.uid, 'production');
                if (savedState) {
                    params.api.applyColumnState({ state: savedState, applyOrder: true });
                }
            } catch (e) {
                console.error("Failed to load saved layout", e);
            }
        }
    }, [user])
    const gridStateHandlers = useGridState('production', gridApi)

    // Fetch Products for item code mapping
    useEffect(() => {
        const fetchProducts = async () => {
            const prodsSnap = await getDocs(collection(db, 'fg_products'))
            const pMap = new Map()
            prodsSnap.docs.forEach(doc => {
                pMap.set(doc.id, doc.data())
            })
            setProductsMap(pMap)
        }
        fetchProducts()
    }, [])

    // Modals
    const [showAddModal, setShowAddModal] = useState(false)
    const [showBulkModal, setShowBulkModal] = useState(false)
    const [editingData, setEditingData] = useState<any>(null)
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ isOpen: boolean, item: any | null }>({
        isOpen: false,
        item: null
    })

    // 1. Fetch Sheets
    useEffect(() => {
        let isSubscribed = true;
        const q = query(
            collection(db, 'fg_inventory_sheets'),
            where('section', '==', 'finished_goods'),
            orderBy('year', 'desc'),
            orderBy('month', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!isSubscribed) return;
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSheets(data);

            setSelectedSheet((prev: any) => {
                if (!prev && data.length > 0) return data[0];
                if (prev) {
                    const current = data.find(s => s.id === prev.id);
                    return current || prev;
                }
                return prev;
            });
        });
        return () => {
            isSubscribed = false;
            unsubscribe();
        };
    }, []);

    // 2. Fetch Transactions for Selected Sheet
    useEffect(() => {
        let isSubscribed = true;
        if (!selectedSheet) {
            setRowData([]);
            return;
        }

        const q = query(
            collection(db, 'fg_inventory_transactions'),
            where('sheet_id', '==', selectedSheet.id),
            where('transaction_type', '==', 'Manufactured Product')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!isSubscribed) return;
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data({ serverTimestamps: 'estimate' })
            }));

            // Re-sort locally to ensure estimated timestamps are at the top
            data.sort((a: any, b: any) => {
                const dateA = a.createdAt?.toMillis ? a.createdAt.toMillis() : Date.now();
                const dateB = b.createdAt?.toMillis ? b.createdAt.toMillis() : Date.now();
                return dateB - dateA;
            });

            setRowData(data);
        });
        return () => {
            isSubscribed = false;
            unsubscribe();
        };
    }, [selectedSheet]);

    const handleDelete = async () => {
        if (!deleteConfirmation.item) return;

        try {
            const batch = writeBatch(db);
            const item = deleteConfirmation.item;

            // 1. Revert Stock (Decrement)
            if (item.product_id && item.quantity) {
                const prodRef = doc(db, 'fg_products', item.product_id);
                batch.update(prodRef, {
                    current_stock: increment(-Number(item.quantity)),
                    updatedAt: serverTimestamp() // Import this if needed, or just skip updatedAt for reversal
                });
            }

            // 2. Delete Transaction
            const transRef = doc(db, 'fg_inventory_transactions', item.id);
            batch.delete(transRef);

            await batch.commit();
            setDeleteConfirmation({ isOpen: false, item: null });

        } catch (error) {
            console.error("Error deleting production entry:", error);
            alert("Failed to delete entry.");
        }
    }

    const columnDefs = [
        { headerName: 'Date', field: 'date', valueFormatter: formatDate, sortable: true, filter: true, width: 120 },
        { headerName: 'PO Number', field: 'po_no', sortable: true, filter: true, width: 120 },
        { headerName: 'Customer', field: 'customer_name', sortable: true, filter: true, width: 150 },
        { headerName: 'Category', field: 'category_name', sortable: true, filter: true, width: 130 },
        {
            headerName: 'Item Code',
            field: 'item_code',
            sortable: true,
            filter: true,
            width: 130,
            valueGetter: (params: any) => {
                if (params.data.item_code) return params.data.item_code;
                return params.data.product_id ? (productsMap.get(params.data.product_id)?.item_code || '') : '';
            }
        },
        { headerName: 'Product', field: 'product_name', sortable: true, filter: true, flex: 2 },
        { headerName: 'Box Qty', field: 'box_qty', sortable: true, filter: true, type: 'numericColumn', width: 100, valueFormatter: formatNumber },
        { headerName: 'Qty/Box', field: 'qty_per_box', sortable: true, filter: true, type: 'numericColumn', width: 100, valueFormatter: formatNumber },
        { headerName: 'Total Qty', field: 'quantity', sortable: true, filter: true, type: 'numericColumn', width: 100, valueFormatter: formatNumber },
        {
            headerName: 'Actions',
            pinned: 'right' as 'right',
            width: 100,
            cellRenderer: (params: any) => canEdit ? (
                <div className="flex gap-2 justify-center">
                    <button onClick={() => {
                        setEditingData(params.data);
                        setShowAddModal(true);
                    }} className="p-1 hover:bg-gray-200 rounded">
                        <img src={editIcon} alt="Edit" className="w-4 h-4 opacity-70 hover:opacity-100" />
                    </button>
                    <button onClick={() => setDeleteConfirmation({ isOpen: true, item: params.data })} className="p-1 hover:bg-red-100 rounded">
                        <img src={deleteIcon} alt="Delete" className="w-4 h-4 opacity-70 hover:opacity-100" />
                    </button>
                </div>
            ) : null
        }
    ];

    return (
        <div className="flex h-[calc(100vh-100px)] bg-gray-100 overflow-hidden text-gray-800 relative">
            {/* Sidebar */}
            <div className="w-64 bg-white border-r flex flex-col flex-shrink-0 shadow-sm h-full">
                <div className="p-4 border-b bg-white">
                    <h2 className="text-lg font-bold text-gray-800">Production Sheets</h2>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {sheets.length === 0 ? (
                        <div className="text-gray-500 text-center text-sm mt-4">No sheets found</div>
                    ) : (
                        sheets.map(sheet => (
                            <button
                                key={sheet.id}
                                onClick={() => setSelectedSheet(sheet)}
                                className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition flex justify-between items-center ${selectedSheet?.id === sheet.id
                                    ? 'bg-blue-600 text-white shadow-md'
                                    : 'bg-white text-gray-700 hover:bg-gray-100 hover:text-blue-600 border border-transparent hover:border-gray-200'
                                    }`}
                            >
                                <span>{MONTHS[sheet.month - 1]} {sheet.year}</span>
                            </button>
                        ))
                    )}
                </div>
                <div className="p-4 border-t bg-white text-xs text-gray-400 text-center">
                    Sheets created automatically
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-w-0 bg-white">
                <div className="flex justify-between items-center p-4 border-b">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">
                            {selectedSheet ? `Production: ${MONTHS[selectedSheet.month - 1]} ${selectedSheet.year}` : 'Production'}
                        </h1>
                    </div>
                    <div className="flex gap-3">
                        {canEdit && (
                            <button
                                onClick={() => setShowBulkModal(true)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded shadow font-bold text-sm transition"
                            >
                                Bulk Add
                            </button>
                        )}
                        {canEdit && (
                            <button
                                onClick={() => {
                                    setEditingData(null);
                                    setShowAddModal(true);
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow font-bold text-sm flex items-center gap-2 transition"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                Add Entry
                            </button>
                        )}
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
                                <ColumnManager api={gridApi} onClose={() => setShowColManager(false)} gridId="production" />
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex-1 p-4 flex flex-col overflow-hidden">
                    {selectedSheet ? (
                        <div className="ag-theme-quartz w-full flex-1" style={{ height: '100%', width: '100%' }}>
                            <AgGridReact
                                enableCellTextSelection={true}
                                onGridReady={onGridReady}
                                rowData={rowData}
                                columnDefs={columnDefs}
                                defaultColDef={{ resizable: true, sortable: true }}
                                pagination={true}
                                paginationPageSize={20}
                                animateRows={true}
                                icons={{
                                    filter: `<img src="${filterIcon}" style="width: 15px; height: 15px;" />`,
                                    menu: `<img src="${filterIcon}" style="width: 15px; height: 15px;" />`
                                }}
                                {...gridStateHandlers}
                            />
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400">
                            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            <p className="text-lg">Select a sheet to view production records</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Modals */}
            <AddProductionModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onSuccess={() => {/* Grid updates via snapshot */ }}
                initialData={editingData}
            />
            <BulkProductionModal
                isOpen={showBulkModal}
                onClose={() => setShowBulkModal(false)}
                onSuccess={() => {/* Grid updates via snapshot */ }}
            />
            <ConfirmationModal
                isOpen={deleteConfirmation.isOpen}
                onCancel={() => setDeleteConfirmation({ isOpen: false, item: null })}
                onConfirm={handleDelete}
                title="Delete Production Entry"
                message="Are you sure? This will reverse the stock addition for this product."
                isDangerous={true}
            />
        </div>
    )
}
