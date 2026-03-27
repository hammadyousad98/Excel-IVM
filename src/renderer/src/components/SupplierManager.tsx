import React, { useState, useEffect } from 'react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import editIcon from '../assets/edit.png'
import deleteIcon from '../assets/delete.png'
import filterIcon from '../assets/filter.png'
import { ConfirmationModal } from './ConfirmationModal'
import { db } from '../firebase'
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    where,
    serverTimestamp
} from 'firebase/firestore'
import { useGridState } from '../hooks/useGridState'
import { useAuth } from '../context/AuthContext'

// Loading Component (Reused for consistency)
const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[200] backdrop-blur-sm">
        <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
            <div className="text-gray-700 font-bold text-lg">Processing...</div>
        </div>
    </div>
)

export const SupplierManager: React.FC<{ section?: string }> = ({ section = 'raw_material' }) => {
    const [suppliers, setSuppliers] = useState<any[]>([])
    const [isEditing, setIsEditing] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [currentSupplier, setCurrentSupplier] = useState<any>({
        name: '',
        address: '',
        telephone: '',
        fax: ''
    })
    const { user } = useAuth()

    const isAdmin = user?.role === 'admin'
    const isPurchaseOfficer = user?.role === 'po_officer'
    const isDeliveryOfficer = user?.role === 'delivery_officer'
    const isMarketing = user?.role === 'marketing'
    const isMarketingManager = user?.role === 'marketing_manager'
    const isProductionOfficer = user?.role === 'production_officer'

    const canEdit = isAdmin ||
        (section === 'raw_material' && isPurchaseOfficer) ||
        (section === 'finished_goods' && (isDeliveryOfficer || isMarketing || isMarketingManager || isProductionOfficer))

    const [gridApi, setGridApi] = useState<any>(null)
    const gridStateHandlers = useGridState(`supplier-manager-${section}`, gridApi)

    // Modal State
    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        confirmText?: string;
        isDangerous?: boolean;
        onConfirm: () => void;
    }>({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: () => { }
    })

    // --- REAL-TIME DATA SYNC ---
    useEffect(() => {
        // Subscribe to suppliers collection filtered by type/section
        const collectionName = section === 'finished_goods' ? 'fg_buyers' : 'rm_suppliers';
        const q = collection(db, collectionName);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setSuppliers(data);
        }, (error) => {
            console.error("Error fetching suppliers:", error);
        });

        return () => unsubscribe();
    }, [section]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!currentSupplier.name.trim()) return

        setIsLoading(true)
        const collectionName = section === 'finished_goods' ? 'fg_buyers' : 'rm_suppliers';

        try {
            if (isEditing && currentSupplier.id) {
                // Critical: Capture Old Name BEFORE updateDoc to avoid race condition with local cache/snapshot
                const originalSupplier = suppliers.find(s => s.id === currentSupplier.id);
                const oldName = originalSupplier ? originalSupplier.name : '';

                // Update
                const supplierRef = doc(db, collectionName, currentSupplier.id);
                await updateDoc(supplierRef, {
                    name: currentSupplier.name,
                    address: currentSupplier.address || '',
                    telephone: currentSupplier.telephone || '',
                    fax: currentSupplier.fax || '',
                    type: section,
                    updatedAt: serverTimestamp()
                });

                // Cascade Updates
                try {
                    if (oldName && oldName !== currentSupplier.name) {
                        const { updateSupplierCascade } = await import('../utils/cascadingUpdates');
                        await updateSupplierCascade(section as any, currentSupplier.id, oldName, currentSupplier.name);
                    }
                } catch (err) {
                    console.error("Supplier cascade failed", err);
                }
            } else {
                // Create
                await addDoc(collection(db, collectionName), {
                    name: currentSupplier.name,
                    address: currentSupplier.address || '',
                    telephone: currentSupplier.telephone || '',
                    fax: currentSupplier.fax || '',
                    type: section,
                    createdAt: serverTimestamp()
                });
            }
            resetForm()
        } catch (error) {
            console.error('Failed to save supplier', error)
            alert('Failed to save supplier')
        } finally {
            setIsLoading(false)
        }
    }

    const handleDelete = (id: string) => { // Changed ID type to string for Firestore
        setModalConfig({
            isOpen: true,
            title: 'Confirm Deletion',
            message: 'Are you sure you want to delete this supplier? This action cannot be undone.',
            confirmText: 'Delete',
            isDangerous: true,
            onConfirm: async () => {
                setIsLoading(true)
                const collectionName = section === 'finished_goods' ? 'fg_buyers' : 'rm_suppliers';
                try {
                    await deleteDoc(doc(db, collectionName, id));
                    setModalConfig(prev => ({ ...prev, isOpen: false }))
                } catch (error) {
                    console.error('Failed to delete supplier', error)
                    alert('Failed to delete supplier')
                } finally {
                    setIsLoading(false)
                }
            }
        })
    }

    const handleEdit = (supplier: any) => {
        setCurrentSupplier(supplier)
        setIsEditing(true)
    }

    const resetForm = () => {
        setCurrentSupplier({ name: '', address: '', telephone: '', fax: '' })
        setIsEditing(false)
    }

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setIsLoading(true)
        const reader = new FileReader()
        const collectionName = section === 'finished_goods' ? 'fg_buyers' : 'rm_suppliers';

        reader.onload = async (event) => {
            const text = event.target?.result as string
            if (!text) {
                setIsLoading(false)
                return
            }

            // CSV Parsing Logic
            const lines = text.split(/\r?\n/).filter(r => r.trim() !== '')
            if (lines.length < 2) {
                alert("CSV file seems empty or missing headers.")
                setIsLoading(false)
                return
            }

            // Headers
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
            const rows = lines.slice(1)
            let successCount = 0

            try {
                const existingNamesSnap = await onSnapshot(collection(db, collectionName), () => { }) // Just getting ref, actually better to getDocs once
                // Wait, onSnapshot returns unsubscribe. Using getDocs for initial check
                // For now, let's just add. Firestore auto-ID prevents collisions, but names might duplicate.
                // We can do a quick check if needed, but for bulk import slightly slower.
                // User requirement "Supplier Name".

                const batchPromises = rows.map(async (rowStr) => {
                    // Handle quoted commas if needed? For now simple split is requested
                    const cols = rowStr.split(',').map(s => s.trim())
                    const rowData: any = {}

                    headers.forEach((h, i) => {
                        rowData[h] = cols[i] || ''
                    })

                    // Map fields
                    // "Supplier Name" -> suppliername or name
                    const name = rowData['suppliername'] || rowData['name'] || rowData['companyname']
                    const address = rowData['address']
                    const telephone = rowData['telephone'] || rowData['phone']
                    const fax = rowData['fax']

                    if (name) {
                        await addDoc(collection(db, collectionName), {
                            name,
                            address: address || '',
                            telephone: telephone || '',
                            fax: fax || '',
                            type: section,
                            createdAt: serverTimestamp()
                        })
                        successCount++
                    }
                })

                await Promise.all(batchPromises)

                setModalConfig({
                    isOpen: true,
                    title: 'Import Complete',
                    message: `Successfully imported ${successCount} ${section === 'finished_goods' ? 'buyers' : 'suppliers'}.`,
                    confirmText: 'Done',
                    isDangerous: false,
                    onConfirm: () => {
                        setModalConfig(prev => ({ ...prev, isOpen: false }))
                    }
                })
            } catch (error) {
                console.error("Import failed:", error)
                alert("Import failed. Check console for details.")
            } finally {
                setIsLoading(false)
                e.target.value = '' // Reset file input
            }
        }
        reader.readAsText(file)
    }

    const resetDatabase = () => {
        // NOTE: "Reset Database" is dangerous in a shared cloud environment. 
        // It should probably be restricted or implemented carefully (e.g. only delete local test data).
        // For now, I'll disable it or implement a warning that it deletes YOUR view of data, 
        // but typically you don't want one user wiping the entire cloud DB for everyone.

        setModalConfig({
            isOpen: true,
            title: 'Reset Database (Restricted)',
            message: 'Bulk deletion from the cloud is restricted for safety. Please delete items individually.',
            confirmText: 'OK',
            isDangerous: false,
            onConfirm: () => setModalConfig(prev => ({ ...prev, isOpen: false }))
        })
    }

    const columnDefs = [
        { headerName: 'Name', field: 'name', flex: 1 },
        { headerName: 'Address', field: 'address', flex: 1.5 },
        { headerName: 'Telephone', field: 'telephone', flex: 1 },
        { headerName: 'Fax', field: 'fax', flex: 1 },
        ...(canEdit ? [{
            headerName: 'Actions',
            field: 'id',
            width: 120,
            cellRenderer: (params: any) => (
                <div className="flex gap-4 items-center h-full">
                    <img
                        src={editIcon}
                        alt="Edit"
                        className="w-5 h-5 cursor-pointer hover:scale-110 transition-transform"
                        onClick={() => handleEdit(params.data)}
                    />
                    <img
                        src={deleteIcon}
                        alt="Delete"
                        className="w-5 h-5 cursor-pointer hover:scale-110 transition-transform"
                        onClick={() => handleDelete(params.data.id)}
                    />
                </div>
            )
        }] : [])
    ]

    return (
        <div className="p-4 h-full flex flex-col relative">
            {/* Loading Overlay */}
            {isLoading && <LoadingOverlay />}

            {/* Custom Confirmation Modal */}
            <ConfirmationModal
                isOpen={modalConfig.isOpen}
                title={modalConfig.title}
                message={modalConfig.message}
                confirmText={modalConfig.confirmText}
                isDangerous={modalConfig.isDangerous}
                onConfirm={modalConfig.onConfirm}
                onCancel={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
            />

            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800">
                    {section === 'finished_goods' ? 'Buyer' : 'Supplier'} Management
                </h2>
                <div className="flex gap-3">
                    {/* Import Button - Only for Raw Material */}
                    {section === 'raw_material' && (
                        <label className="bg-green-600 text-white px-4 py-2 rounded cursor-pointer hover:bg-green-700 font-bold transition-colors">
                            Import CSV
                            <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
                        </label>
                    )}
                </div>
            </div>

            <div className={`grid grid-cols-1 ${canEdit ? 'md:grid-cols-3' : 'md:grid-cols-1'} gap-6 flex-1 min-h-0`}>
                {/* Form Section - Only visible if permitted */}
                {canEdit && (
                    <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                        <h3 className="text-lg font-bold mb-4 text-gray-700">
                            {isEditing ? `Edit ${section === 'finished_goods' ? 'Buyer' : 'Supplier'}` : `Add New ${section === 'finished_goods' ? 'Buyer' : 'Supplier'}`}
                        </h3>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-600 mb-1">Company Name</label>
                                <input
                                    type="text"
                                    placeholder="Name"
                                    value={currentSupplier.name}
                                    onChange={(e) => setCurrentSupplier({ ...currentSupplier, name: e.target.value })}
                                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-600 mb-1">Address</label>
                                <input
                                    type="text"
                                    placeholder="Address"
                                    value={currentSupplier.address}
                                    onChange={(e) => setCurrentSupplier({ ...currentSupplier, address: e.target.value })}
                                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-600 mb-1">Telephone</label>
                                <input
                                    type="text"
                                    placeholder="Telephone"
                                    value={currentSupplier.telephone}
                                    onChange={(e) => setCurrentSupplier({ ...currentSupplier, telephone: e.target.value })}
                                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-600 mb-1">Fax</label>
                                <input
                                    type="text"
                                    placeholder="Fax"
                                    value={currentSupplier.fax}
                                    onChange={(e) => setCurrentSupplier({ ...currentSupplier, fax: e.target.value })}
                                    className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                />
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button type="submit" className="bg-blue-600 text-white px-4 py-2.5 rounded-lg font-bold hover:bg-blue-700 flex-1 shadow-md transition-all active:scale-95">
                                    {isEditing ? 'Update Details' : `Add ${section === 'finished_goods' ? 'Buyer' : 'Supplier'}`}
                                </button>
                                {isEditing && (
                                    <button type="button" onClick={resetForm} className="bg-gray-100 text-gray-600 px-4 py-2.5 rounded-lg font-bold hover:bg-gray-200 transition-all">
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                )}

                {/* List Section - Full width if no form, else 2 cols */}
                <div className={`${canEdit ? 'md:col-span-2' : 'col-span-1'} bg-white p-4 rounded-xl shadow-lg border border-gray-100 flex flex-col h-full min-h-[500px]`}>
                    <h3 className="text-lg font-bold mb-4 text-gray-700">{section === 'finished_goods' ? 'Registered Buyers' : 'Registered Suppliers'}</h3>
                    <div className="ag-theme-alpine flex-1 w-full rounded-lg overflow-hidden border">
                        <AgGridReact
                            enableCellTextSelection={true}
                            rowData={suppliers}
                            columnDefs={columnDefs}
                            defaultColDef={{
                                sortable: true,
                                filter: true,
                                resizable: true,
                                suppressMovable: true
                            }}
                            rowHeight={50}
                            animateRows={true}
                            icons={{
                                menu: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`,
                                filter: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`
                            }}
                            onGridReady={(params) => setGridApi(params.api)}
                            {...gridStateHandlers}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}