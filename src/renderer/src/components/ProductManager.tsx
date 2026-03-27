import React, { useState, useEffect } from 'react'
import { AgGridReact } from 'ag-grid-react'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import editIcon from '../assets/edit.png'
import deleteIcon from '../assets/delete.png'
import filterIcon from '../assets/filter.png'
import { ConfirmationModal } from './ConfirmationModal'
import { db } from '../firebase'
import * as XLSX from 'xlsx'
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    where,
    getDocs,
    getDoc,
    writeBatch,
    serverTimestamp
} from 'firebase/firestore'
import { useGridState } from '../hooks/useGridState'
import { useAuth } from '../context/AuthContext'

// Loading Component
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

export const ProductManager: React.FC<{ section?: string }> = ({ section = 'raw_material' }) => {
    const [activeTab, setActiveTab] = useState<'products' | 'categories'>('products')
    const [products, setProducts] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [customers, setCustomers] = useState<any[]>([]) // Added for FG Customers
    const [isLoading, setIsLoading] = useState(false) // Global loading state for this component
    const { user } = useAuth()

    const isAdmin = user?.role === 'admin'
    const isPurchaseOfficer = user?.role === 'po_officer'
    const isDeliveryOfficer = user?.role === 'delivery_officer'
    const isMarketing = user?.role === 'marketing'
    const isMarketingManager = user?.role === 'marketing_manager'

    const canEdit = isAdmin ||
        (section === 'raw_material' && isPurchaseOfficer) ||
        (section === 'finished_goods' && (isDeliveryOfficer || isMarketing || isMarketingManager))

    // Product Modal State
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<any>(null)

    // Category Modal State
    const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false)
    const [categoryName, setCategoryName] = useState('')

    // Form State
    const [formData, setFormData] = useState({
        description: '',
        category_id: '',
        customer_id: '', // Added for FG
        uom: '',
        length: '',
        width: '',
        gsm: '',
        item_code: '',
        min_stock_level: 0,
        rate: '' // Raw Material Rate
    })

    // Confirmation Modal State
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

    // Information Modal State (for alerts)
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

    const [gridApi, setGridApi] = useState<any>(null)
    const gridStateHandlers = useGridState(`product-manager-${activeTab}-${section}`, gridApi)

    // Focus Restoration Hook
    useEffect(() => {
        const restoreFocus = () => {
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur()
            }
            window.focus()
        }
        window.addEventListener('focus-restore', restoreFocus)
        return () => window.removeEventListener('focus-restore', restoreFocus)
    }, [])

    const triggerFocusRestore = () => {
        window.focus()
        document.body.click()
    }

    // --- REAL-TIME DATA SYNC ---
    useEffect(() => {
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
        const catCollName = section === 'finished_goods' ? 'fg_categories' : 'rm_categories';

        const qProducts = collection(db, prodCollName);
        const unsubscribeProducts = onSnapshot(qProducts, (snapshot) => {
            const prods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setProducts(prods);
        }, (error) => console.error("Error fetching products:", error));

        const qCategories = collection(db, catCollName);
        const unsubscribeCategories = onSnapshot(qCategories, (snapshot) => {
            const cats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setCategories(cats);
        }, (error) => console.error("Error fetching categories:", error));

        // Fetch Customers for FG
        let unsubscribeCustomers = () => { };
        if (section === 'finished_goods') {
            const qCustomers = collection(db, 'fg_buyers');
            unsubscribeCustomers = onSnapshot(qCustomers, (snapshot) => {
                const custs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setCustomers(custs);
            }, (error) => console.error("Error fetching customers:", error));
        }

        return () => {
            unsubscribeProducts();
            unsubscribeCategories();
            unsubscribeCustomers();
        };
    }, [section]);

    // --- UOM Handling ---
    const [uomOptions, setUomOptions] = useState<any[]>([])

    useEffect(() => {
        const uomCollName = section === 'finished_goods' ? 'fg_UOM' : 'rm_UOM';
        const defaults = section === 'finished_goods'
            ? ['Pc', 'Set']
            : ['BTL', 'Kg', 'Pc', 'Pcs', 'Sheet', 'Roll'];

        const qUom = collection(db, uomCollName);
        const unsubscribeUom = onSnapshot(qUom, async (snapshot) => {
            if (snapshot.empty) {
                // Seed defaults if empty
                const batch = writeBatch(db);
                for (const uom of defaults) {
                    const newRef = doc(collection(db, uomCollName));
                    batch.set(newRef, { name: uom, type: section === 'finished_goods' ? 'fg' : 'rm' });
                }
                try {
                    await batch.commit();
                    console.log(`Seeded ${uomCollName} with defaults`);
                } catch (e) {
                    console.error("Error seeding UOMs", e);
                }
            } else {
                const uoms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setUomOptions(uoms);
            }
        }, (error) => console.error("Error fetching UOMs:", error));

        return () => unsubscribeUom();
    }, [section]);

    // --- Helper for Modals ---
    const showConfirmation = (title: string, message: string, isDangerous: boolean, action: () => void) => {
        setConfirmation({ isOpen: true, title, message, isDangerous, action })
    }

    const showInfo = (title: string, message: string, type: 'error' | 'success' | 'info') => {
        setInfoModal({ isOpen: true, title, message, type })
    }

    // --- Category Handlers ---
    const openCategoryModal = (category: any = null) => {
        if (category) {
            setEditingItem(category)
            setCategoryName(category.name)
        } else {
            setEditingItem(null)
            setCategoryName('')
        }
        setIsCategoryModalOpen(true)
    }

    const handleSaveCategory = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!categoryName.trim()) return

        setIsLoading(true)
        const catCollName = section === 'finished_goods' ? 'fg_categories' : 'rm_categories';

        try {
            if (editingItem) {
                const oldName = editingItem.name;
                const catRef = doc(db, catCollName, editingItem.id);
                await updateDoc(catRef, {
                    name: categoryName,
                    updatedAt: serverTimestamp()
                });

                // Cascade Updates
                try {
                    const { updateCategoryCascade } = await import('../utils/cascadingUpdates');
                    await updateCategoryCascade(section as any, editingItem.id, oldName, categoryName);
                } catch (err) {
                    console.error("Category cascade failed", err);
                }

            } else {
                await addDoc(collection(db, catCollName), {
                    name: categoryName,
                    type: section, // Keeping type for metadata
                    createdAt: serverTimestamp()
                });
            }
            setIsCategoryModalOpen(false)
            setEditingItem(null)
            setCategoryName('')
        } catch (error) {
            console.error('Failed to save category', error)
            showInfo('Error', 'Failed to save category. See console for details.', 'error')
        } finally {
            setIsLoading(false)
        }
    }

    const requestDeleteCategory = (id: string) => {
        showConfirmation(
            'Delete Category',
            'Are you sure you want to delete this category?',
            true,
            () => executeDeleteCategory(id)
        )
    }

    const executeDeleteCategory = async (id: string) => {
        setIsLoading(true)
        const catCollName = section === 'finished_goods' ? 'fg_categories' : 'rm_categories';
        try {
            await deleteDoc(doc(db, catCollName, id));
        } catch (error) {
            console.error('Failed to delete category', error)
            showInfo('Error', 'Failed to delete category. It might be in use.', 'error')
        } finally {
            setConfirmation(prev => ({ ...prev, isOpen: false }))
            setIsLoading(false)
            triggerFocusRestore()
        }
    }

    // --- Product Handlers ---
    const handleSaveProduct = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
        const catCollName = section === 'finished_goods' ? 'fg_categories' : 'rm_categories';

        try {
            let targetCategoryId = formData.category_id



            if (!targetCategoryId) {
                // Standard check (if any) or just let it fail validation if required.
                // Actually the form makes it required.
            }

            const payload: any = {
                description: formData.description,
                category_id: targetCategoryId,
                category_name: categories.find(c => c.id === targetCategoryId)?.name || '',
                uom: formData.uom,
                length: section === 'finished_goods' ? 0 : (Number(formData.length) || 0),
                width: section === 'finished_goods' ? 0 : (Number(formData.width) || 0),
                gsm: section === 'finished_goods' ? 0 : (Number(formData.gsm) || 0),
                item_code: section === 'finished_goods' ? formData.item_code : '',
                min_stock_level: Number(formData.min_stock_level) || 0,
                type: section,
                updatedAt: serverTimestamp(),
            }

            // FG: Add Customer Linkage
            if (section === 'finished_goods') {
                payload.customer_id = formData.customer_id;
                payload.customer_name = customers.find(c => c.id === formData.customer_id)?.name || '';
            }

            if (editingItem) {
                const oldData = {
                    description: editingItem.description,
                    uom: editingItem.uom || ''
                };

                await updateDoc(doc(db, prodCollName, editingItem.id), payload);

                // Cascade Updates
                const newData = {
                    description: payload.description,
                    uom: payload.uom
                };

                // Fire and forget (or await if critical to block UI)
                // We await to show loading state until done
                try {
                    const { updateProductCascade } = await import('../utils/cascadingUpdates');
                    await updateProductCascade(section as any, editingItem.id, oldData, newData);
                } catch (err) {
                    console.error("Cascade update failed", err);
                }
            } else {
                await addDoc(collection(db, prodCollName), {
                    ...payload,
                    rate: 0, // Initialize rate
                    createdAt: serverTimestamp(),
                    current_stock: 0
                });
            }

            setIsModalOpen(false)
            setEditingItem(null)
            resetForm()
        } catch (error) {
            console.error('Failed to save product', error)
            showInfo('Error', 'Failed to save product', 'error')
        } finally {
            setIsLoading(false)
        }
    }

    const requestDeleteProduct = (id: string) => {
        showConfirmation(
            'Delete Product',
            'Are you sure you want to delete this product?',
            true,
            () => executeDeleteProduct(id)
        )
    }

    const executeDeleteProduct = async (id: string) => {
        setIsLoading(true)
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
        try {
            await deleteDoc(doc(db, prodCollName, id));
        } catch (error) {
            console.error('Failed to delete product', error)
            showInfo('Error', 'Failed to delete product', 'error')
        } finally {
            setConfirmation(prev => ({ ...prev, isOpen: false }))
            setIsLoading(false)
            triggerFocusRestore()
        }
    }

    const recalculateAllStock = async () => {
        setIsLoading(true);
        setConfirmation(prev => ({ ...prev, isOpen: false })); // Close confirmation immediately

        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
        const transCollName = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';
        try {
            console.log(`Starting recalculation for ${section}...`);

            // 1. Fetch all products for the current section
            const prodsSnap = await withTimeout(
                getDocs(collection(db, prodCollName)),
                45000,
                "Fetching products took too long"
            );
            console.log(`Fetched ${prodsSnap.size} products.`);

            // 2. Fetch all transactions for the current section
            // Note: This could be very large. If it exceeds 10k-20k docs, it might still slow down.
            const transSnap = await withTimeout(
                getDocs(collection(db, transCollName)),
                60000,
                "Fetching transactions took too long"
            );
            console.log(`Fetched ${transSnap.size} transactions.`);

            const transData = transSnap.docs.map(d => d.data());
            let batch = writeBatch(db);
            let opCount = 0;

            const commitBatch = async () => {
                if (opCount > 0) {
                    await withTimeout(batch.commit(), 60000, "Committing batch took too long");
                    batch = writeBatch(db);
                    opCount = 0;
                }
            };

            for (const productDoc of prodsSnap.docs) {
                const productId = productDoc.id;
                const totalStock = transData
                    .filter(t => {
                        if (t.product_id !== productId) return false;
                        if (t.transaction_type === 'Transfer') return false;
                        // Include 'Opening' transactions even if marked as carry_forward to set initial balances
                        if (t.transaction_type === 'Opening') return true;
                        if (t.is_carry_forward) return false;
                        return true;
                    })
                    .reduce((sum, t) => sum + Number(t.quantity || 0), 0);

                batch.update(doc(db, prodCollName, productId), {
                    current_stock: totalStock,
                    updatedAt: serverTimestamp()
                });

                opCount++;
                if (opCount >= 400) {
                    console.log(`Committing batch (count: ${opCount})...`);
                    await commitBatch();
                }
            }

            await commitBatch();
            console.log("Recalculation finished successfully.");
            showInfo('Success', 'Stock levels have been synchronized based on transaction history.', 'success');
        } catch (error: any) {
            console.error("Recalculation failed", error);
            let msg = error.message;
            if (msg?.includes('TIMEOUT')) {
                msg = "Operation Timed Out. Firestore is responding too slowly (likely quota limits). Please try again later.";
            }
            showInfo('Error', 'Failed to recalculate stock: ' + msg, 'error');
        } finally {
            setIsLoading(false);
        }
    }

    const openProductModal = (product: any = null) => {
        if (product) {
            setEditingItem(product)
            setFormData({
                description: product.description,
                category_id: product.category_id,
                customer_id: product.customer_id || '', // FG customer
                uom: product.uom,
                length: product.length || '',
                width: product.width || '',
                gsm: product.gsm || '',
                item_code: product.item_code || '',
                min_stock_level: Number(product.min_stock_level || 0),
                rate: product.rate || 0
            })
        } else {
            setEditingItem(null)
            resetForm()
        }
        setIsModalOpen(true)
    }

    const normalizeKey = (key: string) => key.toLowerCase().trim().replace(/[\s_-]+/g, '');

    const handleImportProducts = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        setIsLoading(true)
        const reader = new FileReader()
        const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
        const catCollName = section === 'finished_goods' ? 'fg_categories' : 'rm_categories';

        reader.onload = async (e) => {
            const data = e.target?.result
            if (!data) {
                setIsLoading(false)
                return
            }

            try {
                const workbook = XLSX.read(data, { type: 'array' })
                const sheetName = workbook.SheetNames[0]
                const worksheet = workbook.Sheets[sheetName]
                const jsonData = XLSX.utils.sheet_to_json(worksheet)

                console.log("Raw Imported Data:", jsonData);

                let successCount = 0
                const categoryMap = new Map(categories.map(c => [c.name.toLowerCase(), c.id]))

                for (const row of jsonData as any[]) {
                    const normalizedRow: any = {};
                    Object.keys(row).forEach(k => {
                        normalizedRow[normalizeKey(k)] = row[k];
                    });

                    // Mapping based on User Request:
                    // Product Name -> productname
                    // Category -> category
                    // UOM -> uom
                    // L -> l
                    // W -> w
                    // G -> g
                    // Minimum Stock Level -> minimumstocklevel

                    const description = normalizedRow['productname'];
                    const categoryName = normalizedRow['category'] || 'General';

                    if (!description) continue;

                    let catId = categoryMap.get(categoryName.toLowerCase());

                    if (!catId) {
                        try {
                            const newCatRef = await addDoc(collection(db, catCollName), {
                                name: categoryName,
                                type: section,
                                createdAt: serverTimestamp()
                            });
                            catId = newCatRef.id;
                            categoryMap.set(categoryName.toLowerCase(), catId);
                        } catch (err) {
                            console.error("Error creating category:", categoryName, err);
                            continue;
                        }
                    }

                    await addDoc(collection(db, prodCollName), {
                        description: String(description),
                        category_id: catId,
                        category_name: categoryName,
                        uom: normalizedRow['uom'] || 'Kg',
                        length: Number(normalizedRow['l'] || 0),
                        width: Number(normalizedRow['w'] || 0),
                        gsm: Number(normalizedRow['g'] || 0),
                        min_stock_level: Number(normalizedRow['minimumstocklevel'] || 0),
                        current_stock: 0, // Default to 0 as per plan
                        rate: 0,
                        type: section,
                        createdAt: serverTimestamp()
                    });
                    successCount++;
                }

                showInfo('Import Success', `Successfully imported ${successCount} products.`, 'success')
            } catch (error) {
                console.error('Import failed:', error)
                showInfo('Import Error', 'Failed to parse or upload data.', 'error')
            } finally {
                event.target.value = ''
                setIsLoading(false)
                triggerFocusRestore()
            }
        }
        reader.readAsArrayBuffer(file)
    }

    const handleImportCategories = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        setIsLoading(true)
        const reader = new FileReader()
        const catCollName = section === 'finished_goods' ? 'fg_categories' : 'rm_categories';

        reader.onload = async (e) => {
            const data = e.target?.result
            if (!data) {
                setIsLoading(false)
                return
            }

            try {
                const workbook = XLSX.read(data, { type: 'array' })
                const sheetName = workbook.SheetNames[0]
                const worksheet = workbook.Sheets[sheetName]
                const jsonData = XLSX.utils.sheet_to_json(worksheet)

                let successCount = 0
                const existingNames = new Set(categories.map(c => c.name.toLowerCase()))

                for (const row of jsonData as any[]) {
                    const normalizedRow: any = {};
                    Object.keys(row).forEach(k => {
                        normalizedRow[normalizeKey(k)] = row[k];
                    });

                    const name = normalizedRow['name'] || normalizedRow['category'] || normalizedRow['categoryname']

                    if (name && !existingNames.has(String(name).toLowerCase())) {
                        try {
                            await addDoc(collection(db, catCollName), {
                                name: String(name),
                                type: section,
                                createdAt: serverTimestamp()
                            })
                            existingNames.add(String(name).toLowerCase())
                            successCount++
                        } catch (err) {
                            console.error('Failed to import category:', name, err)
                        }
                    }
                }
                showInfo('Import Success', `Successfully imported ${successCount} new categories.`, 'success')
            } catch (error) {
                console.error('Import failed:', error)
                showInfo('Import Error', 'Failed to parse category data.', 'error')
            } finally {
                event.target.value = ''
                setIsLoading(false)
                triggerFocusRestore()
            }
        }
        reader.readAsArrayBuffer(file)
    }

    const resetForm = () => {
        setFormData({
            description: '',
            category_id: categories.length > 0 ? categories[0].id : '',
            customer_id: '',
            uom: '',
            length: '',
            width: '',
            gsm: '',
            item_code: '',
            min_stock_level: 0,
            rate: ''
        })
    }

    const categoryColumns = [
        { field: 'name', headerName: 'Category Name', flex: 1 },
        ...(canEdit ? [{
            headerName: 'Actions',
            width: 120,
            cellRenderer: (params: any) => (
                <div className="flex gap-2 items-center justify-center h-full">
                    <button onClick={() => openCategoryModal(params.data)} title="Edit">
                        <img src={editIcon} className="w-4 h-4" />
                    </button>
                    <button onClick={() => requestDeleteCategory(params.data.id)} title="Delete">
                        <img src={deleteIcon} className="w-4 h-4" />
                    </button>
                </div>
            )
        }] : [])
    ]

    const productColumns = [
        { field: 'description', headerName: 'Product Name', flex: 2 },
        ...(section === 'finished_goods' ? [
            { field: 'item_code', headerName: 'Item Code', width: 120 },
            { field: 'customer_name', headerName: 'Customer', flex: 1 } // Added Customer Column
        ] : []),
        { field: 'category_name', headerName: 'Category', flex: 1 },
        { field: 'current_stock', headerName: 'Stock', width: 100 },
        ...(canEdit ? [{
            headerName: 'Actions',
            width: 120,
            cellRenderer: (params: any) => (
                <div className="flex gap-2 items-center justify-center h-full">
                    <button onClick={() => openProductModal(params.data)} title="Edit">
                        <img src={editIcon} className="w-4 h-4" />
                    </button>
                    <button onClick={() => requestDeleteProduct(params.data.id)} title="Delete">
                        <img src={deleteIcon} className="w-4 h-4" />
                    </button>
                </div>
            )
        }] : [])
    ]

    return (
        <div className="p-6 relative">
            {/* Loading Overlay */}
            {isLoading && <LoadingOverlay />}

            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Product & Category Management</h2>
                <div className="flex gap-2">
                    <button
                        className={`px-4 py-2 rounded ${activeTab === 'products' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
                        onClick={() => setActiveTab('products')}
                    >
                        Products
                    </button>
                    <button
                        className={`px-4 py-2 rounded ${activeTab === 'categories' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
                        onClick={() => setActiveTab('categories')}
                    >
                        Categories
                    </button>

                    {/* Import Button - Raw Material Only
                    {section === 'raw_material' && (
                        <div className="ml-4 flex gap-2">
                            <label className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 cursor-pointer">
                                Import Products (CSV)
                                <input type="file" accept=".csv" className="hidden" onChange={handleImportProducts} />
                            </label>
                        </div>
                    )} */}
                </div>
            </div>

            <div className="mb-4 flex justify-between items-center">
                <div className="flex gap-2">
                    {canEdit && (activeTab === 'products' ? (
                        <button onClick={() => openProductModal()} className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600">
                            Add Product
                        </button>
                    ) : (
                        <button onClick={() => openCategoryModal()} className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600">
                            Add Category
                        </button>
                    ))}
                </div>
                {/* Only Admin or Authorized Officer can recalculate stock */}
                {activeTab === 'products' && (
                    isAdmin ||
                    (user?.role === 'po_officer' && section === 'raw_material') ||
                    (section === 'finished_goods' && (
                        user?.role === 'delivery_officer' ||
                        user?.role === 'marketing' ||
                        user?.role === 'marketing_manager' ||
                        user?.role === 'production_officer'
                    ))
                ) && (
                        <button
                            onClick={() => showConfirmation(
                                'Recalculate Stock',
                                'Are you sure? This will sync all product stock levels to match the sum of their transactions.',
                                false,
                                recalculateAllStock
                            )}
                            className="text-blue-600 hover:text-blue-800 text-sm font-bold flex items-center gap-1"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            Recalculate Stock
                        </button>
                    )}
            </div>

            <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
                <AgGridReact
                    enableCellTextSelection={true}
                    rowData={activeTab === 'products' ? products : categories}
                    columnDefs={activeTab === 'products' ? productColumns : categoryColumns}
                    defaultColDef={{ sortable: true, filter: true, resizable: true }}
                    rowHeight={50}
                    icons={{
                        menu: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`,
                        filter: `<img src="${filterIcon}" style="width: 14px; height: 14px;"/>`
                    }}
                    onGridReady={(params) => setGridApi(params.api)}
                    {...gridStateHandlers}
                />
            </div>

            {/* Confirmation Modal */}
            <ConfirmationModal
                isOpen={confirmation.isOpen}
                title={confirmation.title}
                message={confirmation.message}
                isDangerous={confirmation.isDangerous}
                onConfirm={confirmation.action || (() => { })}
                onCancel={() => setConfirmation(prev => ({ ...prev, isOpen: false }))}
                confirmText={confirmation.isDangerous ? 'Delete' : 'Confirm'}
            />

            {/* Information Modal */}
            <ConfirmationModal
                isOpen={infoModal.isOpen}
                title={infoModal.title}
                message={infoModal.message}
                isDangerous={infoModal.type === 'error'}
                onConfirm={() => setInfoModal(prev => ({ ...prev, isOpen: false }))}
                onCancel={() => setInfoModal(prev => ({ ...prev, isOpen: false }))}
                confirmText="OK"
                cancelText="Close"
            />

            {/* Category Modal */}
            {
                isCategoryModalOpen && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white p-6 rounded-lg w-96">
                            <h3 className="text-xl font-bold mb-4">{editingItem ? 'Edit Category' : 'Add Category'}</h3>
                            <form onSubmit={handleSaveCategory} className="flex flex-col gap-3">
                                <input
                                    className="border p-2 rounded"
                                    placeholder="Category Name"
                                    value={categoryName}
                                    onChange={e => setCategoryName(e.target.value)}
                                    required
                                    autoFocus
                                />
                                <div className="flex justify-end gap-2 mt-4">
                                    <button type="button" onClick={() => setIsCategoryModalOpen(false)} className="px-4 py-2 bg-gray-300 rounded">Cancel</button>
                                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Product Modal */}
            {
                isModalOpen && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white p-6 rounded-lg w-96">
                            <h3 className="text-xl font-bold mb-4">{editingItem ? 'Edit Product' : 'Add Product'}</h3>
                            <form onSubmit={handleSaveProduct} className="flex flex-col gap-3">
                                <input
                                    className="border p-2 rounded"
                                    placeholder="Product Name"
                                    value={formData.description}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    required
                                />
                                <select
                                    className="border p-2 rounded"
                                    value={formData.category_id}
                                    onChange={e => setFormData({ ...formData, category_id: e.target.value })}
                                    required
                                >
                                    <option value="">Select Category</option>
                                    {categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>

                                {section === 'finished_goods' && (
                                    <select
                                        className="border p-2 rounded mb-4"
                                        value={formData.customer_id}
                                        onChange={e => setFormData({ ...formData, customer_id: e.target.value })}
                                        required
                                    >
                                        <option value="">Select Customer</option>
                                        {customers.map(c => (
                                            <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                )}
                                <div className="mb-4">
                                    <label className="block mb-2 font-bold text-gray-700">UOM (Unit of Measure)</label>
                                    <input
                                        list="uom-options"
                                        className="w-full border p-2 rounded"
                                        value={formData.uom}
                                        onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
                                        placeholder={section === 'finished_goods' ? "Select Pc or Set" : "e.g. Kg, Pcs"}
                                    />
                                    <datalist id="uom-options">
                                        {uomOptions.map((uom) => (
                                            <option key={uom.id} value={uom.name} />
                                        ))}
                                    </datalist>
                                </div>

                                {/* Raw Material Rate Input */}
                                {section === 'raw_material' && (
                                    <div className="mb-4">
                                        <label className="block mb-2 font-bold text-gray-700">Rate</label>
                                        <input
                                            type="number"
                                            className="w-full border p-2 rounded"
                                            value={formData.rate}
                                            onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                                            placeholder="Standard Rate (0 if unknown)"
                                            min="0"
                                            step="0.01"
                                        />
                                    </div>
                                )}

                                {/* Finished Goods: Item Code */}
                                {section === 'finished_goods' && (
                                    <div className="mb-4">
                                        <label className="block mb-2 font-bold text-gray-700">Item Code</label>
                                        <input
                                            className="w-full border p-2 rounded"
                                            value={formData.item_code}
                                            onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                                            placeholder="Item Code"
                                        />
                                    </div>
                                )}

                                {/* Raw Materials: L/W/G for PAPER & BOARD */}
                                {section !== 'finished_goods' && categories.find(c => c.id === formData.category_id)?.name === 'PAPER & BOARD' && (
                                    <div className="grid grid-cols-3 gap-4 mb-4 bg-gray-50 p-3 rounded">
                                        <div>
                                            <label className="block mb-1 font-bold text-gray-700 text-sm">Length</label>
                                            <input
                                                type="number"
                                                className="w-full border p-2 rounded"
                                                value={formData.length}
                                                onChange={(e) => setFormData({ ...formData, length: e.target.value })}
                                                placeholder="L"
                                            />
                                        </div>
                                        <div>
                                            <label className="block mb-1 font-bold text-gray-700 text-sm">Width</label>
                                            <input
                                                type="number"
                                                className="w-full border p-2 rounded"
                                                value={formData.width}
                                                onChange={(e) => setFormData({ ...formData, width: e.target.value })}
                                                placeholder="W"
                                            />
                                        </div>
                                        <div>
                                            <label className="block mb-1 font-bold text-gray-700 text-sm">GSM</label>
                                            <input
                                                type="number"
                                                className="w-full border p-2 rounded"
                                                value={formData.gsm}
                                                onChange={(e) => setFormData({ ...formData, gsm: e.target.value })}
                                                placeholder="G"
                                            />
                                        </div>
                                    </div>
                                )}
                                {section !== 'finished_goods' && (
                                    <div>
                                        <label className="block mb-1 text-sm font-semibold text-gray-700">Minimum Stock Level</label>
                                        <input
                                            type="number"
                                            className="border p-2 rounded w-full"
                                            placeholder="Enter minimum stock level"
                                            value={formData.min_stock_level}
                                            onChange={e => setFormData({ ...formData, min_stock_level: Number(e.target.value) })}
                                        />
                                    </div>
                                )}
                                <div className="flex justify-end gap-2 mt-4">
                                    <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 bg-gray-300 rounded">Cancel</button>
                                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </div >
    )
}