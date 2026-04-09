import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

interface AddEntryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => Promise<void>;
    section: string;
    initialData?: any;
    suppliersList: string[];
    warehouses?: any[]; // Added
}

const TRANS_TYPES = ['Opening', 'Issue', 'Adjustment'];

import { SearchableDropdown } from './SearchableDropdown';

export const AddEntryModal: React.FC<AddEntryModalProps> = ({
    isOpen,
    onClose,
    onSave,
    section,
    initialData,
    suppliersList,
    warehouses = [] // Default empty
}) => {
    // Only return null if not open
    if (!isOpen) return null;

    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form State (Shared + Specific)
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [transactionType, setTransactionType] = useState('Opening');
    const [supplier, setSupplier] = useState(''); // Customer for FG
    const [selectedWarehouse, setSelectedWarehouse] = useState(''); // Restored for Opening
    const [category, setCategory] = useState('');
    const [product, setProduct] = useState<any>(null); // Full product object
    const [quantity, setQuantity] = useState<number | ''>('');
    const [rate, setRate] = useState<number | ''>('');
    const [documentNo, setDocumentNo] = useState(''); // New Document No State

    // FG Specific Fields
    const [customerPoNo, setCustomerPoNo] = useState('');
    const [qtyPerBox, setQtyPerBox] = useState<number | ''>('');
    const [noOfCartons, setNoOfCartons] = useState<number | ''>('');
    const [tolerance, setTolerance] = useState<number | ''>('');

    // Dynamic Options
    const [availableCategories, setAvailableCategories] = useState<string[]>([]);
    const [availableProducts, setAvailableProducts] = useState<any[]>([]);
    const [supplierStock, setSupplierStock] = useState<number>(0);

    // New State for RM Refactor
    const [allRmProducts, setAllRmProducts] = useState<any[]>([]);
    const [relevantSuppliers, setRelevantSuppliers] = useState<string[]>([]);
    const [availablePOs, setAvailablePOs] = useState<any[]>([]);
    const [jobCards, setJobCards] = useState<any[]>([]);
    const [selectedJobCardId, setSelectedJobCardId] = useState<string>('');

    // Helper to get Warehouse 1
    const getWarehouse1 = () => warehouses.find(w => w.name === 'Warehouse 1') || warehouses[0];

    // --- Effects ---

    // 1. Reset on Open
    useEffect(() => {
        if (isOpen) {
            // Always fetch RM Products if section is RM
            if (section === 'raw_material') {
                getAllRmProducts();
            }

            if (initialData) {
                // Populate for Edit
                setDate(initialData.date);
                setTransactionType(initialData.transaction_type);
                // Supplier setting moved to after dependency load for RM

                setRate(initialData.rate || '');
                if (initialData.warehouse_id && initialData.transaction_type === 'Opening') {
                    setSelectedWarehouse(initialData.warehouse_id);
                } else {
                    setSelectedWarehouse('');
                }
                setDocumentNo(initialData.grn_no || '');

                if (section === 'finished_goods') {
                    setSupplier(initialData.manual_supplier_name || initialData.supplier_name);
                    setCustomerPoNo(initialData.customer_po_no || '');
                    setQtyPerBox(initialData.qty_per_box || '');
                    setNoOfCartons(initialData.no_of_boxes || '');
                    setTolerance(initialData.tolerance || '');
                }

                // Trigger cascade updates
                loadDependenciesForEdit(initialData);
            } else {
                // Reset for New
                setDate(new Date().toISOString().split('T')[0]);
                setTransactionType(section === 'finished_goods' ? 'Production' : 'Opening');
                setSupplier('');
                setSelectedWarehouse('');
                setCategory('');
                setProduct(null);
                setQuantity('');
                setRate('');
                setSupplierStock(0);
                setAvailableCategories([]);
                setAvailableProducts([]);
                setRelevantSuppliers([]);
                setSelectedJobCardId('');

                // FG Reset
                setCustomerPoNo('');
                setQtyPerBox('');
                setNoOfCartons('');
                setTolerance('');

                if (section === 'raw_material') {
                    fetchActiveJobCards();
                }
            }
        }
    }, [isOpen, initialData, section]);

    const fetchActiveJobCards = async () => {
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
            console.error("Error fetching job cards:", e);
        }
    };

    const loadDependenciesForEdit = async (data: any) => {
        setIsLoading(true);
        try {
            if (section === 'raw_material') {
                // 1. Ensure Products Loaded
                const products = await getAllRmProducts();

                // 2. Find and Set Product
                const foundProduct = products.find(p => p.description === data.product_name || p.id === data.product_id);
                // Explicitly cast to any to avoid "Property does not exist" on union types
                const pObj: any = foundProduct || { description: data.product_name, id: data.product_id, category_name: data.category_name };
                setProduct(pObj);
                setCategory(pObj.category_name || data.category_name);

                // 3. Fetch Relevant Suppliers for this Product
                const suppliers = await getSuppliersForProduct(pObj.id, pObj.description);
                // Add the current supplier if not in list (legacy data support)
                const currentSupplier = data.supplier_name || '';
                if (currentSupplier && !suppliers.includes(currentSupplier)) suppliers.push(currentSupplier);
                setRelevantSuppliers(suppliers);
                setSupplier(currentSupplier);
                setSelectedJobCardId(data.job_card_id || '');

                setQuantity(Math.abs(data.quantity));

                if (pObj) {
                    if (data.transaction_type === 'Issue' || data.transaction_type === 'Adjustment') {
                        const wId = data.warehouse_id || getWarehouse1()?.id;
                        await fetchStock(pObj.id, undefined, wId);
                    } else if (data.transaction_type === 'Opening') {
                        if (data.warehouse_id) {
                            await fetchStock(pObj.id, undefined, data.warehouse_id);
                        } else {
                            await fetchStock(pObj.id, data.supplier_name);
                        }
                    } else {
                        await fetchStock(pObj.id, data.supplier_name);
                    }
                }
            } else {
                // FG Load Logic (Unchanged)
                await fetchAllFgCategories();
                setCategory(data.manual_category_name || data.category_name);
                await fetchFgProducts(data.manual_category_name || data.category_name);
                const productList = await getFgProducts(data.manual_category_name || data.category_name);
                const p = productList.find((x: any) => x.id === data.product_id);
                setProduct(p || { description: data.product_name, id: data.product_id });
                setQuantity(data.quantity);
                setSupplier(data.manual_supplier_name || data.supplier_name);
            }

        } catch (e) {
            console.error(e);
            setError("Failed to load edit data");
        } finally {
            setIsLoading(false);
        }
    }

    // FG: Fetch POs when Supplier (Customer) changes
    useEffect(() => {
        if (section === 'finished_goods' && supplier) {
            fetchCustPOs(supplier);
        } else {
            setAvailablePOs([]);
        }
    }, [supplier, section]);

    const fetchCustPOs = async (custName: string) => {
        setAvailablePOs([]); // Clear immediately to avoid stale data
        try {
            const buyersSnap = await getDocs(query(collection(db, 'fg_buyers'), where('name', '==', custName)));
            if (!buyersSnap.empty) {
                const custId = buyersSnap.docs[0].id;
                const soSnap = await getDocs(query(collection(db, 'fg_sales_orders'), where('customer_id', '==', custId)));
                const pos = soSnap.docs.map(d => ({
                    id: d.id,
                    po_no: d.data().po_no,
                    items: d.data().items || []
                }));
                // Unique POs
                const uniquePOs = Array.from(new Set(pos.map(p => p.po_no))).map(poNo => {
                    return pos.find(p => p.po_no === poNo);
                });
                setAvailablePOs(uniquePOs as any[]);
            }
        } catch (e) {
            console.error("Error fetching POs", e);
            setAvailablePOs([]);
        }
    }

    // Re-fetch products if PO changes to apply filter
    useEffect(() => {
        if (section === 'finished_goods' && category) {
            fetchFgProducts(category);
        }
    }, [customerPoNo, section, category]);

    // 2. Filter Options (RM Logic vs FG Logic)
    useEffect(() => {
        if (section === 'raw_material') {
            // Disabled old RM logic
        } else {
            // FG: Load Categories on Mount or Open (Handled in Reset/Load)
            // But we need to load categories if just opened in new mode
            if (!initialData && isOpen && availableCategories.length === 0) {
                fetchAllFgCategories();
            }
        }
    }, [supplier, section, isOpen, initialData]);

    const fetchAllFgCategories = async () => {
        try {
            const snap = await getDocs(collection(db, 'fg_categories'));
            setAvailableCategories(snap.docs.map(d => d.data().name));
        } catch (e) { console.error(e) }
    }

    const fetchFgProducts = async (cat: string) => {
        let prodList = await getFgProducts(cat);

        // Filter by PO if selected
        if (customerPoNo) {
            const selectedPO = availablePOs.find(p => p.po_no === customerPoNo);
            if (selectedPO && selectedPO.items) {
                prodList = prodList.filter((p: any) =>
                    selectedPO.items.some((item: any) => item.product_id === p.id)
                );
            }
        }

        setAvailableProducts(prodList);
    }

    const getFgProducts = async (cat: string) => {
        try {
            // We need category ID to filter products? 
            // Or filter client side? Let's filter client side if we fetched all, 
            // or query by category_id if we have it? 
            // The products collection stores category_id. The category dropdown value is name.
            // We first need to find the category ID for the name.
            const catSnap = await getDocs(query(collection(db, 'fg_categories'), where('name', '==', cat)));
            if (!catSnap.empty) {
                const catId = catSnap.docs[0].id;
                // Let's assume we can fetch all FG products for now to avoid ID hell
                const allSnap = await getDocs(collection(db, 'fg_products'));

                console.log(`[AddEntryModal] Found Category '${cat}' with ID: ${catId}`);
                console.log(`[AddEntryModal] Total Products: ${allSnap.size}`);

                // Filter using string comparison to handle both legacy numeric IDs and new Firestore string IDs
                const filtered = allSnap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter((p: any) => {
                        const match = String(p.category_id) === String(catId);
                        if (!match && p.category_name === cat) return true; // Fallback: match by name if ID fails
                        return match;
                    });

                console.log(`[AddEntryModal] Filtered Products: ${filtered.length}`, filtered);
                return filtered;
            }
        } catch (e) { console.error(e) }
        return [];
    }

    // 3. RM: Filter Products when Category Changes
    const filteredRmProducts = useMemo(() => {
        if (section !== 'raw_material') return [];
        if (!category) return [];
        return availableProducts.filter(p => p.category_name === category);
    }, [category, availableProducts, section]);

    // 4. FG: Fetch Products when Category Changes
    useEffect(() => {
        if (section === 'finished_goods' && category && !initialData) {
            fetchFgProducts(category);
            setProduct(null);
        }
    }, [category, section, initialData]);

    // 5. RM: Update Stock when Transaction Type Changes (to handle Warehouse 1 switch)
    useEffect(() => {
        if (section === 'raw_material' && product && transactionType) {
            if (transactionType === 'Issue' || transactionType === 'Adjustment') {
                const w1 = getWarehouse1();
                if (w1) {
                    fetchStock(product.id, undefined, w1.id);
                }
            } else if (transactionType === 'Opening') {
                if (selectedWarehouse) {
                    fetchStock(product.id, undefined, selectedWarehouse);
                } else {
                    // If no warehouse selected yet for Opening, maybe show supplier stock or 0?
                    // Probably 0 or wait for warehouse selection
                    fetchStock(product.id, supplier); // Fallback to supplier stock logic
                }
            } else if (supplier) {
                // Revert to Supplier stock for Receipt/Return etc? (Logic is vague here)
                fetchStock(product.id, supplier);
            }
        }
    }, [transactionType, product, section, supplier, selectedWarehouse]);

    // NEW Helper functions for RM
    const getAllRmProducts = async () => {
        try {
            const snap = await getDocs(collection(db, 'rm_products'));
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setAllRmProducts(list);
            return list as any[];
        } catch (e) { console.error(e); return [] as any[]; }
    }

    const getSuppliersForProduct = async (productId: string, productName: string) => {
        const relevant = new Set<string>();

        // 1. Check POs (Filter client side as per plan)
        try {
            // Note: Optimally we would query, but structure limits us.
            // Fetching all might be heavy if thousands of POs.
            // Let's try to limit to recent? No, we need all valid suppliers.
            // For now, fetch ALL rm_purchase_orders. 
            // Optimization: If `rm_products` had a `suppliers` array array field, this would be instant.
            const poSnap = await getDocs(collection(db, 'rm_purchase_orders'));
            poSnap.docs.forEach(d => {
                const data = d.data();
                if (data.items && Array.isArray(data.items)) {
                    const hasProduct = data.items.some((i: any) => i.product_id === productId || i.product_description === productName);
                    if (hasProduct && data.supplier_name) {
                        relevant.add(data.supplier_name);
                    }
                }
            });
        } catch (e) { console.error("Error fetching POs for supplier lookup", e); }

        // 2. Check Inventory Transactions (Opening, Stock In)
        try {
            // We can query transactions by product_id directly!
            const q = query(
                collection(db, 'rm_inventory_transactions'),
                where('product_id', '==', productId),
                // where('transaction_type', 'in', ['Opening', 'Purchase']) // Optional filter, but technically any supplier who has interacted is relevant? 
                // User said: "from the created PO and enteries with opening transaction type"
                where('transaction_type', '==', 'Opening')
            );
            const transSnap = await getDocs(q);
            transSnap.docs.forEach(d => {
                const s = d.data().supplier_name || d.data().manual_supplier_name;
                if (s) relevant.add(s);
            });

        } catch (e) { console.error("Error fetching Transactions for supplier lookup", e); }

        return Array.from(relevant);
    }

    // Handler for Product Selection (RM)
    const handleRmProductChange = async (prodId: string) => {
        const p = allRmProducts.find(x => x.id === prodId);
        setProduct(p || null);

        if (p) {
            setCategory(p.category_name || ''); // Auto-set Category
            setRate(p.rate || '');

            // Fetch Suppliers
            setIsLoading(true);
            const suppliers = await getSuppliersForProduct(p.id, p.description);
            setRelevantSuppliers(suppliers);
            setIsLoading(false);

            // Check Warehouse/Stock Logic
            if (transactionType === 'Issue' || transactionType === 'Adjustment') {
                const w1 = getWarehouse1()?.id;
                // Issue logic usually needs specific stock.
                // If Issue, we default to Warehouse 1 stock?
                // User said: "system shouldn't ask for warehouse it will by default select the warehouse1"
                fetchStock(p.id, undefined, w1);
            } else if (transactionType === 'Opening' && selectedWarehouse) {
                fetchStock(p.id, undefined, selectedWarehouse);
            } else {
                setSupplierStock(0);
            }
        } else {
            setCategory('');
            setRelevantSuppliers([]);
            setSupplierStock(0);
        }
    };


    // --- Helpers ---

    const getOptionsForSupplier = async (supplierName: string) => {
        const cats = new Set<string>();
        const prods = new Map<string, any>(); // Use Map to dedupe by ID

        // 1. Query POs
        try {
            const qPO = query(
                collection(db, 'rm_purchase_orders'),
                where('supplier_name', '==', supplierName)
            );
            const snapPO = await getDocs(qPO);

            snapPO.docs.forEach(doc => {
                const data = doc.data();
                const rootCategory = data.category || '';

                if (data.items) {
                    data.items.forEach((item: any) => {
                        if (item.product_id) {
                            const categoryName = item.category_name || rootCategory;
                            prods.set(item.product_id, {
                                id: item.product_id,
                                description: item.product_description || item.manual_product_name,
                                category_name: categoryName,
                                uom: item.uom,
                                length: item.length,
                                width: item.width,
                                gsm: item.gsm,
                                rate: item.rate
                            });
                            if (categoryName) cats.add(categoryName);
                        }
                    });
                }
            });
        } catch (e) {
            console.error("Error fetching PO options:", e);
        }

        // 2. Query Transactions (for manual Opening entries etc)
        try {
            const qTrans = query(
                collection(db, 'rm_inventory_transactions'),
                where('supplier_name', '==', supplierName)
            );
            const snapTrans = await getDocs(qTrans);

            snapTrans.docs.forEach(doc => {
                const data = doc.data();
                if (data.product_id) {
                    const categoryName = data.category_name || data.manual_category_name;
                    // Only add if not already present (PO takes precedence for details usually, but manual is fine too)
                    if (!prods.has(data.product_id)) {
                        prods.set(data.product_id, {
                            id: data.product_id,
                            description: data.product_name || data.manual_product_name,
                            category_name: categoryName,
                            uom: data.uom,
                            length: data.length,
                            width: data.width,
                            gsm: data.gsm,
                            rate: data.rate
                        });
                    }
                    if (categoryName) cats.add(categoryName);
                }
            });
        } catch (e) {
            console.error("Error fetching Transaction options:", e);
        }

        console.log(`[AddEntryModal] Found ${cats.size} Categories and ${prods.size} Products for supplier '${supplierName}'`);

        return {
            categories: Array.from(cats),
            products: Array.from(prods.values())
        };
    };

    const fetchOptionsForSupplier = async (supplierName: string) => {
        setIsLoading(true);
        try {
            const { categories, products } = await getOptionsForSupplier(supplierName);
            setAvailableCategories(categories);
            setAvailableProducts(products);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchStock = async (productId: string, supplierName?: string, warehouseId?: string) => {
        console.log(`[AddEntryModal] Fetching Stock for Product: ${productId}, Supplier: '${supplierName}', Warehouse: '${warehouseId}'`);
        try {
            let stock = 0;
            const prodColl = section === 'finished_goods' ? 'fg_products' : 'rm_products';

            if (warehouseId) {
                const stockRef = doc(db, prodColl, productId, 'warehouse_stock', warehouseId);
                const snap = await getDoc(stockRef);
                if (snap.exists()) stock = snap.data().current_stock || 0;
            } else if (supplierName) {
                const cleanSupplier = supplierName.trim();
                const stockRef = doc(db, prodColl, productId, 'supplier_stock', cleanSupplier);
                const snap = await getDoc(stockRef);
                if (snap.exists()) {
                    stock = snap.data().current_stock || 0;
                }
            }
            setSupplierStock(stock);
        } catch (e) {
            console.error('[AddEntryModal] Error fetching stock:', e);
            setSupplierStock(0);
        }
    };

    // FG Qty Auto Calc
    useEffect(() => {
        if (section === 'finished_goods') {
            const qty = Number(qtyPerBox || 0) * Number(noOfCartons || 0);
            setQuantity(qty > 0 ? qty : '');
        }
    }, [qtyPerBox, noOfCartons, section]);

    const handleSave = async () => {
        setError(null);

        if (section === 'raw_material') {
            if (!date || !supplier || !category || !product || quantity === '' || rate === '') {
                setError("All fields are compulsory.");
                return;
            }
            if (transactionType === 'Opening' && !selectedWarehouse) {
                setError("Please select a Warehouse for Opening stock.");
                return;
            }
        } else {
            // FG Validation
            if (!date || !supplier || !customerPoNo || !category || !product || qtyPerBox === '' || noOfCartons === '' || tolerance === '') {
                setError("All fields are compulsory.");
                return;
            }
        }

        const qtyNum = Number(quantity);
        if (qtyNum <= 0) {
            setError("Quantity must be greater than 0");
            return;
        }

        // RM Stock Validation
        if (section === 'raw_material') {
            if (transactionType === 'Issue' && qtyNum > supplierStock) {
                setError(`Insufficient stock for Issue. Available: ${supplierStock}`);
                return;
            }
            // Only block Issue if stock is 0. Opening/Adjustment are allowed to create/modify stock.
            if (transactionType === 'Issue' && supplierStock <= 0) {
                setError(`Stock is 0. Cannot create ${transactionType} entry.`);
                return;
            }
        }

        setIsSaving(true);
        try {
            const length = Number(product.length || 0);
            const width = Number(product.width || 0);
            const gsm = Number(product.gsm || 0);
            const rateNum = Number(rate || 0); // FG might not use rate here? User didn't ask for Rate in popup.

            let calculated_kgs = 0;
            // CHECK PERSISTED WEIGHT LOGIC
            // If product has unit_weight, use it preferred over formula
            // "If user edit the Kg ... that edited Kg will be used everywhere" -> Implies unit weight
            if (product.unit_weight && product.unit_weight > 0) {
                calculated_kgs = product.unit_weight * qtyNum;
                if (product.allow_decimals === false) {
                    calculated_kgs = Math.floor(calculated_kgs);
                } else {
                    calculated_kgs = Number(calculated_kgs.toFixed(2));
                }
            } else if (length && width && gsm) {
                // Fallback to formula if no manual override exists
                calculated_kgs = Number(((length * 25.4 / 1000) * (width * 25.4 / 1000) * (gsm / 1000) * qtyNum).toFixed(2));
            }

            const total_amount = rateNum * (calculated_kgs || qtyNum);

            // Determine logic for Warehouse
            let warehouseId = null;
            let warehouseName = null;

            if (section === 'raw_material') {
                if (transactionType === 'Issue' || transactionType === 'Adjustment') {
                    const w1 = getWarehouse1();
                    if (w1) {
                        warehouseId = w1.id;
                        warehouseName = w1.name;
                    }
                } else if (transactionType === 'Opening') {
                    const w = warehouses.find(wh => wh.id === selectedWarehouse);
                    if (w) {
                        warehouseId = w.id;
                        warehouseName = w.name;
                    }
                }
            }

            const payload: any = {
                id: initialData?.id,
                date,
                transaction_type: transactionType,
                type: 'Manual',
                supplier_name: supplier,
                category_name: category,
                product_id: product.id,
                item_code: product.item_code || '',
                product_name: product.description,
                quantity: qtyNum,
                uom: product.uom,
                length,
                width,
                gsm,
                rate: rateNum,
                calculated_kgs,
                total_amount: Number(total_amount.toFixed(2)),
                amount: Number(total_amount.toFixed(2)),
                section: section,
                warehouse_id: warehouseId,
                warehouse_name: warehouseName,
                grn_no: documentNo, // Save as GRN No
                job_card_id: selectedJobCardId || null
            };

            if (section === 'finished_goods') {
                payload.manual_supplier_name = supplier; // Use manual for FG Customer
                payload.manual_category_name = category;
                payload.manual_product_name = product.description;
                payload.customer_po_no = customerPoNo;
                payload.po_no = customerPoNo; // Ensure compatibility with POCreate
                payload.no_of_boxes = Number(noOfCartons);
                payload.qty_per_box = Number(qtyPerBox);
                payload.tolerance = Number(tolerance);
            }

            await onSave(payload);
            onClose();
        } catch (e) {
            console.error(e);
            setError("Failed to save entry.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center">
                    <h3 className="text-xl font-bold text-gray-800">{initialData ? 'Edit Entry' : 'Add Entry'}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                </div>

                <div className="p-6 space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">
                            {error}
                        </div>
                    )}

                    {/* Shared Fields */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date</label>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        {section === 'raw_material' && (
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Type</label>
                                <select
                                    value={transactionType}
                                    onChange={(e) => setTransactionType(e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    disabled={!!initialData}
                                >
                                    {TRANS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                        )}
                        {['Opening', 'Issue', 'Adjustment'].includes(transactionType) && section === 'raw_material' && (
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Document Number <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={documentNo}
                                    onChange={(e) => setDocumentNo(e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Enter Document / GRN No"
                                    required
                                />
                            </div>
                        )}
                        {section === 'finished_goods' && (
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Customer</label>
                                <SearchableDropdown
                                    options={suppliersList.map(s => ({ id: s, label: s }))}
                                    value={supplier}
                                    onChange={(val) => setSupplier(val as string)}
                                    placeholder="Select Customer"
                                />
                            </div>
                        )}
                        {section === 'raw_material' && (
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Linked Job Card (Optional)</label>
                                <SearchableDropdown
                                    options={jobCards.map(jc => ({ id: jc.id, label: `${jc.jobCardNo} - ${jc.jobName}` }))}
                                    value={selectedJobCardId}
                                    onChange={(val) => setSelectedJobCardId(val as string)}
                                    placeholder={`Select Job Card (${jobCards.length})`}
                                />
                            </div>
                        )}
                    </div>

                    {/* RM Supplier & Warehouse */}
                    {section === 'raw_material' && (
                        <div className="grid grid-cols-2 gap-4">
                            {/* Product First */}
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Product</label>
                                {/* Searchable Select for Product */}
                                <SearchableDropdown
                                    options={allRmProducts.map(p => ({ id: p.id, label: p.description }))}
                                    value={product?.id || ''}
                                    onChange={(val) => handleRmProductChange(val as string)}
                                    placeholder={`Select Product (${allRmProducts.length})`}
                                />
                            </div>

                            {/* Supplier Second */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Supplier</label>
                                <SearchableDropdown
                                    options={(section === 'raw_material' && (transactionType === 'Issue' || transactionType === 'Adjustment'))
                                        ? relevantSuppliers.map(s => ({ id: s, label: s })) // Strict for Issue/Adj
                                        : suppliersList.map(s => ({ id: s, label: s }))     // All for Opening
                                    }
                                    value={supplier}
                                    onChange={(val) => {
                                        const s = val as string;
                                        setSupplier(s);
                                        if (product) {
                                            if (transactionType === 'Issue' || transactionType === 'Adjustment') {
                                                // Issue usually Warehouse 1, but maybe check supplier stock if relevant?
                                                // Actually logic below handles stock fetch based on transactionType.
                                                // We just set supplier here.
                                            } else {
                                                // For Opening/Other, fetch Supplier Stock
                                                if (transactionType === 'Opening' && !selectedWarehouse) {
                                                    fetchStock(product.id, s);
                                                } else if (transactionType !== 'Opening') {
                                                    fetchStock(product.id, s);
                                                }
                                            }
                                        }
                                    }}
                                    placeholder="Select Supplier"
                                />
                            </div>

                            {/* Warehouse Dropdown - Only for Opening */}
                            {transactionType === 'Opening' && (
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Warehouse</label>
                                    <select
                                        value={selectedWarehouse}
                                        onChange={(e) => {
                                            setSelectedWarehouse(e.target.value);
                                            if (product && e.target.value) {
                                                fetchStock(product.id, undefined, e.target.value);
                                            }
                                        }}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="">Select Warehouse</option>
                                        {warehouses.map(w => (
                                            <option key={w.id} value={w.id}>{w.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Auto-Derived Category Display (Read Only) */}
                            <div className="col-span-2">
                                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Category (Auto)</label>
                                <div className="px-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-600 border border-gray-200">
                                    {category || 'No Category'}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* FG Fields */}
                    {section === 'finished_goods' && (
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">PO No.</label>
                            <SearchableDropdown
                                options={availablePOs.map(p => ({ id: p.po_no, label: p.po_no }))}
                                value={customerPoNo}
                                onChange={(val) => setCustomerPoNo(val as string)}
                                placeholder={supplier ? "Select PO" : "Select Customer First"}
                            />
                        </div>
                    )}

                    {/* Category & Item (FG Only now) */}
                    {section === 'finished_goods' && (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Item Category</label>
                                <select
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="">Select Category</option>
                                    {availableCategories.map(c => (
                                        <option key={c} value={c}>{c}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Item</label>
                                <select
                                    value={product?.id || ''}
                                    onChange={(e) => {
                                        const list = availableProducts;
                                        const p = list.find(prod => prod.id === Number(e.target.value) || prod.id === e.target.value);
                                        setProduct(p || null);
                                        if (p) {
                                            setSupplierStock(0);
                                            setRate('');
                                        } else {
                                            setSupplierStock(0);
                                            setRate('');
                                        }
                                    }}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    disabled={!category}
                                >
                                    <option value="">Select Item</option>
                                    {availableProducts.map(p => (
                                        <option key={p.id} value={p.id}>{p.description}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Quantity Section */}
                    {section === 'raw_material' ? (
                        <div className="grid grid-cols-3 gap-4 items-end">
                            <div className="relative">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Quantity</label>
                                <input
                                    type="number"
                                    value={quantity}
                                    onChange={(e) => setQuantity(Number(e.target.value))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    disabled={!product}
                                    placeholder="0.00"
                                />
                                {product && product.uom && (
                                    <span className="absolute right-3 top-8 text-xs text-gray-400">{product.uom}</span>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Rate</label>
                                <input
                                    type="number"
                                    value={rate}
                                    onChange={(e) => setRate(Number(e.target.value))}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    disabled={!product}
                                    placeholder="0.00"
                                />
                            </div>
                            <div className="bg-blue-50 p-2 rounded-lg border border-blue-100 flex flex-col justify-center h-[42px]">
                                <span className="text-xs text-blue-500 font-semibold uppercase">
                                    {(transactionType === 'Issue' || transactionType === 'Adjustment') ? 'Available Stock (Warehouse 1)' : 'Available Stock'}
                                </span>
                                <span className="text-lg font-bold text-blue-700 leading-none">
                                    {supplierStock} {product?.uom || ''}
                                </span>
                            </div>
                        </div>
                    ) : (
                        // FG Quantity Logic
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Qty per Box</label>
                                    <input
                                        type="number"
                                        value={qtyPerBox}
                                        onChange={(e) => setQtyPerBox(Number(e.target.value))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="0"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">No. Of Cartons</label>
                                    <input
                                        type="number"
                                        value={noOfCartons}
                                        onChange={(e) => setNoOfCartons(Number(e.target.value))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 items-end">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tolerance</label>
                                    <input
                                        type="number"
                                        value={tolerance}
                                        onChange={(e) => setTolerance(Number(e.target.value))}
                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="0"
                                    />
                                </div>
                                <div className="bg-gray-100 p-2 rounded-lg text-right">
                                    <span className="text-xs text-gray-500 uppercase block">Total Quantity</span>
                                    <span className="text-xl font-bold text-gray-800">{quantity || 0} {product?.uom}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-gray-600 font-medium hover:bg-gray-200 transition-colors"
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-6 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 transition-shadow shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSaving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                        Save Entry
                    </button>
                </div>
            </div>
        </div>
    );
};
