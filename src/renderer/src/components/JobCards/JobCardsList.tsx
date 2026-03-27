import React, { useState, useEffect } from 'react'
import { collection, onSnapshot, query, orderBy, doc, getDoc, where, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../context/AuthContext'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'
import filterIcon from '../../assets/filter.png'
import editIcon from '../../assets/edit.png'
import { saveUserLayout, getUserLayout, resetUserLayout } from '../../utils/userLayoutService'
import { useGridState } from '../../hooks/useGridState'
import { JobCardForm } from './JobCardForm'


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

interface JobCardsListProps {
    deepLink?: { jobCardId: string, phase: number, jobNum?: string } | null
    onDeepLinkHandled?: () => void
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

export const JobCardsList: React.FC<JobCardsListProps> = ({ deepLink, onDeepLinkHandled }) => {
    const { user } = useAuth()
    const [rowData, setRowData] = useState<any[]>([])
    const [showForm, setShowForm] = useState(false)
    const [editingJob, setEditingJob] = useState<any>(null)
    const [targetPhase, setTargetPhase] = useState<number | undefined>(undefined)
    const [isDeepLinkLoading, setIsDeepLinkLoading] = useState(false)

    // Ag-Grid API State
    const [gridApi, setGridApi] = useState<any>(null)
    const [showColManager, setShowColManager] = useState(false)
    const onGridReady = React.useCallback(async (params: any) => {
        setGridApi(params.api)
        if (user) {
            try {
                const savedState = await getUserLayout(user.uid, 'job-cards');
                if (savedState) {
                    params.api.applyColumnState({ state: savedState, applyOrder: true });
                }
            } catch (e) {
                console.error("Failed to load saved layout", e);
            }
        }
    }, [user])
    const gridStateHandlers = useGridState('job-cards', gridApi)

    // Handle deep link
    useEffect(() => {
        if (deepLink) {
            console.log("[JobCardsList] Processing deep link:", deepLink);
            setIsDeepLinkLoading(true);
            const fetchJob = async () => {
                try {
                    let jobData = null;
                    let jobId = deepLink.jobCardId;

                    if (jobId) {
                        const docRef = doc(db, 'job_cards', jobId);
                        const docSnap = await getDoc(docRef);
                        if (docSnap.exists()) {
                            jobData = { id: docSnap.id, ...docSnap.data() };
                        }
                    }

                    // Fallback to Job Card Number search if ID not found or missing
                    if (!jobData && deepLink.jobNum) {
                        console.log("[JobCardsList] ID not found/missing. Searching by Job Number:", deepLink.jobNum);
                        const q = query(collection(db, 'job_cards'), where('jobCardNo', '==', deepLink.jobNum));
                        const querySnap = await getDocs(q);
                        if (!querySnap.empty) {
                            const docSnap = querySnap.docs[0];
                            jobData = { id: docSnap.id, ...docSnap.data() };
                            console.log("[JobCardsList] Found job via number search.");
                        }
                    }

                    if (jobData) {
                        console.log("[JobCardsList] Job card prepared, opening form...");
                        setEditingJob(jobData);
                        setTargetPhase(deepLink.phase);
                        setShowForm(true);
                    } else {
                        console.error("[JobCardsList] Could not find job card for deep link.", deepLink);
                    }
                } catch (error) {
                    console.error("Error fetching job card for deep link", error);
                } finally {
                    console.log("[JobCardsList] Clearing deep link state.");
                    setIsDeepLinkLoading(false);
                    if (onDeepLinkHandled) onDeepLinkHandled();
                }
            }
            fetchJob();
        }
    }, [deepLink, onDeepLinkHandled]);

    // Fetch Job Cards
    useEffect(() => {
        let isSubscribed = true;
        const q = query(
            collection(db, 'job_cards'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!isSubscribed) return;
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setRowData(data);
        });

        return () => {
            isSubscribed = false;
            unsubscribe();
        };
    }, []);

    const columnDefs = [
        { headerName: 'Job Card No', field: 'jobCardNo', sortable: true, filter: true, width: 130 },
        { headerName: 'Date', field: 'jobCardDate', sortable: true, filter: true, width: 120 },
        { headerName: 'Customer', field: 'customerData.customerName', sortable: true, filter: true, flex: 1 },
        { headerName: 'Job Name', field: 'customerData.jobName', sortable: true, filter: true, flex: 1 },
        { headerName: 'Current Phase', field: 'currentPhase', sortable: true, filter: true, width: 130 },
        {
            headerName: 'Status',
            field: 'status',
            sortable: true,
            filter: true,
            width: 120,
            cellRenderer: (params: any) => {
                const statusStr = params.value || ''
                if (statusStr === 'completed') return <span className="text-green-600 font-bold">Completed</span>
                return <span className="text-blue-600 font-bold capitalize">{statusStr.replace('_', ' ')}</span>
            }
        },
        {
            headerName: 'Actions',
            pinned: 'right' as 'right',
            width: 100,
            cellRenderer: (params: any) => (
                <div className="flex gap-2 justify-center">
                    <button onClick={() => {
                        setEditingJob(params.data);
                        setShowForm(true);
                    }} className="p-1 hover:bg-gray-200 rounded">
                        <img src={editIcon} alt="View/Edit" className="w-4 h-4 opacity-70 hover:opacity-100" />
                    </button>
                </div>
            )
        }
    ];

    if (isDeepLinkLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] bg-white">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p className="text-gray-600 font-medium">Loading Job Card...</p>
            </div>
        )
    }

    if (showForm) {
        return (
            <JobCardForm
                onClose={() => {
                    setShowForm(false)
                    setEditingJob(null)
                    setTargetPhase(undefined)
                }}
                initialData={editingJob}
                initialPhase={targetPhase}
            />
        )
    }

    return (
        <div className="flex h-[calc(100vh-100px)] bg-gray-100 overflow-hidden text-gray-800 relative">
            <div className="flex-1 flex flex-col min-w-0 bg-white">
                <div className="flex justify-between items-center p-4 border-b">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">Job Cards</h1>
                    </div>
                    <div className="flex gap-3">
                        {user?.role !== 'pre_press' && (
                            <button
                                onClick={() => {
                                    setEditingJob(null)
                                    setShowForm(true)
                                }}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow font-bold text-sm flex items-center gap-2 transition"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                New Job Card
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
                                <ColumnManager api={gridApi} onClose={() => setShowColManager(false)} gridId="job-cards" />
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex-1 p-4 flex flex-col overflow-hidden">
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
                </div>
            </div>
        </div>
    )
}
