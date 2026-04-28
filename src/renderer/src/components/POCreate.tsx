import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { db } from '../firebase'
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    where,
    orderBy,
    serverTimestamp,
    increment
} from 'firebase/firestore'

import { whatsappService } from '../utils/whatsappService'
import { ConfirmationModal } from './ConfirmationModal'
import { SearchableDropdown } from './SearchableDropdown'

// Loading Component
const LoadingOverlay = () => (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[200] backdrop-blur-sm">
        <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center animate-in fade-in zoom-in duration-200">
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
            <div className="text-gray-700 font-bold text-lg">Processing...</div>
        </div>
    </div>
)

// Map roles to phase numbers (Duplicate from JobCardForm for navigation/notifications)
const PHASE_ROLES: Record<number, string[]> = {
    1: ['admin', 'marketing'],
    2: ['admin', 'pre_press'],
    3: ['admin', 'po_officer'],
    4: ['admin'],
    5: ['admin', 'production'],
    6: ['admin', 'qc'],
    7: ['admin', 'delivery_officer'],
    8: ['admin', 'head'],
}

interface POCreateProps {
    onCancel: () => void
    onSuccess: () => void
    initialData?: any
    section?: string
}

export const POCreate: React.FC<POCreateProps> = ({ onCancel, onSuccess, initialData, section = 'raw_material' }) => {
    const { user } = useAuth()

    const sendJobCardNotifications = async (jobCardId: string, jobCardNo: string, targetPhase: number) => {
        const roles = PHASE_ROLES[targetPhase] || [];
        const message = targetPhase === 4
            ? `Phase 3 is complete (PO Created). Phase 4 (Store) is ready to start.`
            : targetPhase === 8
                ? `Phase 7 is complete (DN Created). Phase 8 is ready for closure.`
                : `Phase ${targetPhase - 1} is complete. Phase ${targetPhase} is ready to start.`;

        for (const role of roles) {
            if (role === 'admin') continue;
            await addDoc(collection(db, 'notifications'), {
                role: role,
                title: `Job Card Update: ${jobCardNo}`,
                message: message,
                read: false,
                createdAt: serverTimestamp(),
                linkToJobCard: jobCardNo,
                jobCardId: jobCardId,
                targetPhase: targetPhase
            });
        }

        try {
            const whatsappMsg = whatsappService.formatJobCardMessage(jobCardNo, targetPhase, false);
            const usersRef = collection(db, 'users');
            const qUsers = query(usersRef, where('role', 'in', roles));
            const usersSnap = await getDocs(qUsers);

            for (const userDoc of usersSnap.docs) {
                const userData = userDoc.data();
                if (userData.whatsappNumber) {
                    await whatsappService.sendMessage(userData.whatsappNumber, whatsappMsg);
                }
            }
        } catch (waErr) {
            console.error("WhatsApp notification failed", waErr);
        }
    };
    const [isLoading, setIsLoading] = useState(false)
    const [suppliers, setSuppliers] = useState<any[]>([])
    const [products, setProducts] = useState<any[]>([])
    const [categories, setCategories] = useState<any[]>([])
    const [uoms, setUoms] = useState<string[]>(['BTL', 'Kg', 'Pc', 'Pcs', 'Sheets'])
    const [selectedSupplier, setSelectedSupplier] = useState('')
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])

    // Warehouse State (Raw Material Only)
    const [warehouses, setWarehouses] = useState<any[]>([])
    const [selectedWarehouse, setSelectedWarehouse] = useState('')

    // Delivery Note Specific State
    const [transactions, setTransactions] = useState<any[]>([])
    const [linkedPO, setLinkedPO] = useState('')
    const [vehicleNo, setVehicleNo] = useState('')
    const [driverName, setDriverName] = useState('')
    const [driverMobile, setDriverMobile] = useState('')
    const [destination, setDestination] = useState('')
    const [ogpNo, setOgpNo] = useState('')
    const [grnNo, setGrnNo] = useState('')

    // New State for Tax and Category (and Sales Tax Flag for FG)
    const [enableTax, setEnableTax] = useState(false)
    const [taxRate, setTaxRate] = useState(18)
    const [selectedCategory, setSelectedCategory] = useState('')
    const [hasSalesTax, setHasSalesTax] = useState(false) // New State for FG Delivery Note
    const [jobCards, setJobCards] = useState<any[]>([])
    const [selectedJobCardId, setSelectedJobCardId] = useState('')
    const [freightAmount, setFreightAmount] = useState<number>(0)

    const [items, setItems] = useState<any[]>([
        { product_id: '', quantity: 0, rate: 0, length: 0, width: 0, gsm: 0, calculated_kgs: 0, allow_decimals: true }
    ])
    const [showConfirm, setShowConfirm] = useState(false)
    const [errorModal, setErrorModal] = useState<{ open: boolean; message: string }>({ open: false, message: '' })

    // Fetched POs state (Defined before use in useMemo)
    const [availablePOs, setAvailablePOs] = useState<any[]>([]);

    useEffect(() => {
        if (section === 'finished_goods' && selectedSupplier) {
            const fetchPOs = async () => {
                try {
                    const q = query(
                        collection(db, 'fg_sales_orders'),
                        where('customer_id', '==', selectedSupplier)
                    );
                    const snap = await getDocs(q);
                    // Store full PO data including items
                    const pos = snap.docs.map(d => ({
                        id: d.id,
                        po_no: d.data().po_no,
                        items: d.data().items || []
                    }));
                    // Set unique POs (by po_no) but keep the object
                    const uniquePOs = Array.from(new Set(pos.map(p => p.po_no)))
                        .map(poNo => pos.find(p => p.po_no === poNo));

                    setAvailablePOs(uniquePOs.filter(Boolean));
                } catch (e) {
                    console.error("Error fetching customer POs", e);
                }
            }
            fetchPOs();
        } else {
            setAvailablePOs([]);
            if (section === 'finished_goods') setLinkedPO('');
        }
    }, [selectedSupplier, section]);

    useEffect(() => {
        let isSubscribed = true;
        const supplierCollName = section === 'finished_goods' ? 'fg_buyers' : 'rm_suppliers';
        const productCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
        const categoryCollName = section === 'finished_goods' ? 'fg_categories' : 'rm_categories';
        const uomCollName = section === 'finished_goods' ? 'fg_UOM' : 'rm_UOM';

        const unsubSups = onSnapshot(collection(db, supplierCollName), (snap: any) => {
            if (!isSubscribed) return;
            const s = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
            const uniqueSuppliers = Array.from(new Map(s.map((item: any) => [item.name, item])).values());
            setSuppliers(uniqueSuppliers);
        });

        const unsubProds = onSnapshot(collection(db, productCollName), (snap: any) => {
            if (!isSubscribed) return;
            const p = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
            setProducts(p);
        });

        const unsubCats = onSnapshot(collection(db, categoryCollName), (snap: any) => {
            if (!isSubscribed) return;
            const c = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
            setCategories(c);
        });

        const unsubUoms = onSnapshot(collection(db, uomCollName), (snap: any) => {
            if (!isSubscribed) return;
            if (!snap.empty) {
                setUoms(snap.docs.map((d: any) => d.data().name));
            } else {
                setUoms(section === 'finished_goods' ? ['Pc', 'Set'] : ['Kg', 'Sheet', 'Pc', 'Pcs', 'BTL']);
            }
        });

        let unsubWarehouses = () => {};
        if (section === 'raw_material') {
            unsubWarehouses = onSnapshot(collection(db, 'warehouses'), (snap: any) => {
                if (!isSubscribed) return;
                const warehouseData = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
                const uniqueWarehouses = Array.from(new Map(warehouseData.map((item: any) => [item.name, item])).values());
                setWarehouses(uniqueWarehouses);
            });
        }

        let unsubJCs = () => {};
        const jcQuery = query(
            collection(db, 'job_cards'),
            where('currentPhase', '>=', section === 'finished_goods' ? 7 : 3)
        );
        unsubJCs = onSnapshot(jcQuery, (snap: any) => {
            if (!isSubscribed) return;
            const fetchedJCs = snap.docs
                .map((d: any) => ({ id: d.id, ...d.data() }))
                .filter((jc: any) => jc.currentPhase < 8)
                .sort((a: any, b: any) => (b.jobCardNo || '').localeCompare(a.jobCardNo || ''));
            setJobCards(fetchedJCs);
        });

        // Derived selected job card data for validation


        // Fetch transactions for FG matching (one-shot is okay here or listener)
        if (section === 'finished_goods') {
            getDocs(collection(db, 'fg_inventory_transactions')).then(snap => {
                if (isSubscribed) setTransactions(snap.docs.map(d => d.data()));
            });
        }

        // Pre-fill if editing
        if (initialData) {
            setSelectedSupplier(initialData.supplier_id)
            setDate(initialData.date)
            setSelectedCategory(initialData.category || '')
            if (initialData.tax_rate > 0) {
                setEnableTax(true)
                setTaxRate(initialData.tax_rate)
            }
            if (section === 'finished_goods') {
                setLinkedPO(initialData.linked_po_id || '')
                setVehicleNo(initialData.vehicle_no || '')
                setDriverName(initialData.driver_name || '')
                setDriverMobile(initialData.driver_mobile || '')
                setDestination(initialData.destination || '')
                setOgpNo(initialData.ogp_no || '')
                setHasSalesTax(initialData.has_sales_tax || false)
            }
            if (section === 'raw_material' && initialData.grn_no) {
                setGrnNo(initialData.grn_no)
                if (initialData.warehouse_id) setSelectedWarehouse(initialData.warehouse_id)
            }
            if (section === 'raw_material' && initialData.job_card_id) {
                setSelectedJobCardId(initialData.job_card_id)
            }
            if (initialData.freight_amount) {
                setFreightAmount(initialData.freight_amount)
            }
            if (initialData.items) {
                setItems(initialData.items.map((i: any) => ({
                    product_id: i.product_id,
                    quantity: i.quantity,
                    rate: i.rate,
                    length: i.length || 0,
                    width: i.width || 0,
                    gsm: i.gsm || 0,
                    uom: i.uom,
                    no_of_boxes: i.no_of_boxes,
                    qty_per_box: i.qty_per_box,
                    has_short_item: i.has_short_item || false,
                    short_no_of_boxes: i.short_no_of_boxes || 0,
                    short_qty_per_box: i.short_qty_per_box || 0,
                    category: i.category,
                    calculated_kgs: i.calculated_kgs || 0,
                    allow_decimals: i.allow_decimals !== undefined ? i.allow_decimals : true
                })))
            }
        }

        return () => {
            isSubscribed = false;
            unsubSups();
            unsubProds();
            unsubCats();
            unsubUoms();
            unsubWarehouses();
            unsubJCs();
        };
    }, [initialData, section]);


    const addItem = () => {
        setItems([...items, { product_id: '', quantity: 0, rate: 0, length: 0, width: 0, gsm: 0, uom: '', has_short_item: false, short_no_of_boxes: 0, short_qty_per_box: 0, calculated_kgs: 0, allow_decimals: true }])
    }

    const removeItem = (index: number) => {
        const newItems = [...items]
        newItems.splice(index, 1)
        setItems(newItems)
    }

    const updateItem = (index: number, field: string, value: any) => {
        const newItems = [...items]
        newItems[index][field] = value

        // Auto-calculate weight if dimensions change
        if (['length', 'width', 'gsm', 'quantity'].includes(field)) {
            const item = newItems[index];
            // Check if Paper (Heuristic: Category name or has GSM)
            // We can also check isPaperCategory variable if it was passed, but item.category is safer per row
            if (item.category === 'PAPER & BOARD' || item.gsm > 0) {
                const l = Number(item.length || 0);
                const w = Number(item.width || 0);
                const g = Number(item.gsm || 0);
                const q = Number(item.quantity || 0);

                // Only calculate if we have dimensions. If quantity is 0, weight is 0.
                if (l > 0 && w > 0 && g > 0) {
                    const kgs = (l * 25.4 / 1000) * (w * 25.4 / 1000) * (g / 1000) * q;
                    // Keep precision but avoid float errors
                    newItems[index].calculated_kgs = Number(kgs.toFixed(3));
                }
            }
        }
        setItems(newItems)
    }

    // Filtering Logic for Finished Goods (Cascade: PO -> Category -> Product)
    const filteredProducts = React.useMemo(() => {
        if (section !== 'finished_goods') {
            // Raw Material Logic (Category Filter only)
            if (!selectedCategory) return products;
            return products.filter(p => {
                const cat = categories.find(c => c.id === p.category_id);
                return cat && cat.name === selectedCategory;
            });
        } else {
            // Finished Goods Logic (PO -> Category -> Product)
            // 1. If PO is selected, filter products that exist in that PO's items
            let validProductIds = new Set<string>();
            let validProductNames = new Set<string>();

            if (linkedPO) {
                // Find items for this PO from availablePOs (which are fetched from fg_sales_orders)
                const selectedPOObj = availablePOs.find(p => p.po_no === linkedPO);
                if (selectedPOObj && selectedPOObj.items) {
                    selectedPOObj.items.forEach((item: any) => {
                        validProductIds.add(item.product_id);
                        validProductNames.add(item.product_name || item.product_description); // Support both naming conventions
                    });
                }
            }

            // If PO selected, only show products from that PO
            // If Category selected, further filter
            return products.filter(p => {
                // Filter by PO (Strict)
                if (linkedPO) {
                    // Check by ID first, then Name
                    if (!validProductIds.has(p.id) && !validProductNames.has(p.description)) return false;
                }

                // Filter by Category
                if (selectedCategory) {
                    const cat = categories.find(c => c.id === p.category_id);
                    return cat && cat.name === selectedCategory;
                }

                return true;
            });
        }
    }, [products, categories, selectedCategory, linkedPO, availablePOs, section]);

    const selectedJobCard = React.useMemo(() => jobCards.find(jc => jc.id === selectedJobCardId), [jobCards, selectedJobCardId]);

    // Derive unique qty_per_box values per product from production history (FG only)
    const productionQtyMap = React.useMemo(() => {
        if (section !== 'finished_goods') return {};
        const map: Record<string, number[]> = {};
        transactions
            .filter((t: any) => t.transaction_type === 'Manufactured Product' && t.product_id && t.qty_per_box > 0)
            .forEach((t: any) => {
                if (!map[t.product_id]) map[t.product_id] = [];
                if (!map[t.product_id].includes(Number(t.qty_per_box))) {
                    map[t.product_id].push(Number(t.qty_per_box));
                }
            });
        return map;
    }, [transactions, section]);


    // Derived Categories for Dropdown (FG only)
    const filteredCategories = React.useMemo(() => {
        if (section !== 'finished_goods') return categories;

        // On Edit (initialData present), we might want to show ALL categories or ensure the selected one is valid
        // But the constraint is: filter based on Linked PO.
        if (!linkedPO) return categories;

        // Find items for this PO from availablePOs
        const selectedPOObj = availablePOs.find(p => p.po_no === linkedPO);
        // If data not loaded yet, return all
        if (!selectedPOObj || !selectedPOObj.items) return categories;

        const validCatNames = new Set(selectedPOObj.items.map((i: any) => i.category || i.category_name));
        return categories.filter(c => validCatNames.has(c.name));
    }, [categories, linkedPO, availablePOs, section]);

    // Determine if Paper columns should be shown (Global Category OR Any Item is Paper)
    const isPaperCategory = selectedCategory === 'PAPER & BOARD' || (section === 'raw_material' && items.some(i => (i.category === 'PAPER & BOARD' || i.gsm > 0)));

    const handleSaveClick = (e: React.FormEvent) => {
        e.preventDefault()

        // Strict Validation for Finished Goods
        if (section === 'finished_goods' && !linkedPO) {
            setErrorModal({ open: true, message: "Please select a Linked PO (Sales Order) before creating a Delivery Note." });
            return;
        }
        // // Mandatory Job Card for Paper & Board in RM
        //         const hasPaperItem = section === 'raw_material' && items.some(item =>
        //             (item.category || '').toUpperCase() === 'PAPER & BOARD'
        //         );

        //         if (hasPaperItem && !selectedJobCardId) {
        //             setErrorModal({ open: true, message: "Job Card selection is compulsory for 'Paper & Board' category." });
        //             return;
        //         }
        const form = e.currentTarget as HTMLFormElement
        if (form.checkValidity()) {
            setShowConfirm(true)
        } else {
            form.reportValidity()
        }
    }

    // Helper to generate PO Series ID (PO-2024-001) using a counter document
    const generateSeriesPOId = async (section: string): Promise<string> => {
        const year = new Date().getFullYear();

        // Custom Logic for FG Delivery Note numbering: EC|YY-YY|NNN
        if (section === 'finished_goods') {
            const now = new Date();
            // User Rule: Jan 2026 is "26-27". Switches on 1st June (assume July 1st based on "Start July").
            // Standard FY logic normally: Jan 2026 is part of 25-26.
            // But User wants "26-27" for this period.
            // Logic: Base Year = Current Year + (Month >= 6 ? 1 : 0) ? 
            // Let's test: Jan 2026 (0) => 2026. "26-27".
            // July 2026 (6) => 2027. "27-28".
            // This matches the "Shift forward" logic implied.

            let baseYear = now.getFullYear();
            if (now.getMonth() >= 6) { // July onwards
                baseYear += 1;
            }

            const startYY = baseYear.toString().slice(-2);
            const endYY = (baseYear + 1).toString().slice(-2);
            const fyString = `${startYY}-${endYY}`; // "26-27"

            const counterDocId = `dn_counter_EC`; // Single counter or yearly? Usually continuous or yearly. Let's use custom field
            // Use a specific counter document for DNs
            const counterRef = doc(db, 'counters', 'fg_delivery_notes');

            try {
                const newId = await import('firebase/firestore').then(async ({ runTransaction }) => {
                    return runTransaction(db, async (transaction) => {
                        const counterDoc = await transaction.get(counterRef);
                        let nextCount = 1;
                        if (counterDoc.exists()) {
                            nextCount = counterDoc.data().count + 1;
                        }

                        // Set/Update counter
                        transaction.set(counterRef, { count: nextCount }, { merge: true });

                        // Generate ID like EC|26-27|001
                        // Note: User requested "number will be dynamic increase", doesn't explicitly say reset yearly.
                        // Assuming continuous or simple increment for now.
                        return `EC|${fyString}|${nextCount}`;
                    });
                });
                return newId;
            } catch (error) {
                console.error("DN Counter increment failed:", error);
                return `EC|${fyString}|${Date.now().toString().slice(-4)}`;
            }
        }

        // --- Standard Logic for Raw Material POs ---
        const prefix = 'PO';
        const counterDocId = `${prefix}_${year}`;
        const counterRef = doc(db, 'counters', counterDocId);

        // Run transaction to safely increment counter
        try {
            const newId = await import('firebase/firestore').then(async ({ runTransaction }) => {
                return runTransaction(db, async (transaction) => {
                    const counterDoc = await transaction.get(counterRef);
                    let nextCount = 1;
                    if (counterDoc.exists()) {
                        nextCount = counterDoc.data().count + 1;
                    }

                    // Set/Update counter
                    transaction.set(counterRef, { count: nextCount }, { merge: true });

                    // Generate ID like PO-2024-001
                    const paddedCount = nextCount.toString().padStart(3, '0');
                    return `${prefix}-${year}-${paddedCount}`;
                });
            });
            return newId;
        } catch (error) {
            console.error("Counter increment failed:", error);
            // Fallback to random if transaction fails (unlikely)
            return `${prefix}-${year}-${Math.floor(Math.random() * 1000)}`;
        }
    }

    const executeSave = async () => {

        setIsLoading(true)

        // Validate Rates (must be > 0) for RM
        if (section !== 'finished_goods') {
            const invalidRateItem = items.find(i => Number(i.rate) <= 0)
            if (invalidRateItem) {
                alert('All items must have a valid rate greater than 0.')
                setIsLoading(false)
                return
            }
        }

        // Check if quantity <= stock
        // Removed strict Physical Stock check for FG to allow Tolerance over-delivery.

        if (section === 'finished_goods') {
            for (const item of items) {
                // Tolerance Validation & Production Validation
                if (linkedPO) {
                    const product = products.find(p => p.id === item.product_id);
                    const productName = product ? product.description : '';

                    const poItems = transactions.filter(t =>
                        (t.po_no === linkedPO || t.customer_po_no === linkedPO) &&
                        (
                            (t.product_id && t.product_id === item.product_id) ||
                            (productName && (t.product_name === productName || t.manual_product_name === productName))
                        )
                    );

                    if (poItems.length > 0) {
                        // --- Metric 1: Total Ordered & Tolerance (from Sales Orders) ---
                        // SO items are positive quantity, type 'Sales Order'
                        const totalOrdered = poItems
                            .filter(t => t.transaction_type === 'Sales Order' && Number(t.quantity) === 0 && Number(t.display_quantity) > 0)
                            .reduce((sum, t) => sum + Number(t.display_quantity || 0), 0);

                        const totalTolerance = poItems
                            .filter(t => t.transaction_type === 'Sales Order')
                            .reduce((sum, t) => sum + Number(t.tolerance || 0), 0);

                        // Fallback: If no Sales Order transaction found (rare), assume 0 or handle logic
                        // But usually we have SO transactions.

                        // --- Metric 2: Total Produced (from Manufactured Product) ---
                        const totalProduced = poItems
                            .filter(t => t.transaction_type === 'Manufactured Product')
                            .reduce((sum, t) => sum + Number(t.quantity || 0), 0);

                        // --- Metric 3: Already Delivered (from Delivery Notes) ---
                        // These are negative quantities in "transaction", or we check "Delivery Note" type
                        // We sum the ABSOLUTE value.
                        let alreadyDelivered = poItems
                            .filter(t => t.transaction_type === 'Delivery Note' || t.transaction_type === 'Sale')
                            .reduce((sum, t) => sum + Math.abs(Number(t.quantity || 0)), 0);

                        // FIX: If Editing, exclude the quantity of THIS specific item from the "Already Delivered" count
                        if (initialData && initialData.items) {
                            const initialItem = initialData.items.find((i: any) => i.product_id === item.product_id);
                            if (initialItem) {
                                alreadyDelivered -= Number(initialItem.quantity || 0);
                                if (alreadyDelivered < 0) alreadyDelivered = 0;
                            }
                        }

                        const currentQty = Number(item.quantity || 0);
                        const totalAfterDelivery = alreadyDelivered + currentQty;
                        const maxAllowedSO = totalOrdered + totalTolerance;

                        // Check 1: Sales Order + Tolerance
                        if (totalAfterDelivery > maxAllowedSO) {
                            setErrorModal({
                                open: true,
                                message: `Sales Order Limit Exceeded for ${productName || 'Product'}. \n\n` +
                                    `Ordered: ${totalOrdered} \n` +
                                    `Tolerance: ${totalTolerance} \n` +
                                    `Max Allowed: ${maxAllowedSO} \n\n` +
                                    `Previously Delivered: ${alreadyDelivered} \n` +
                                    `Current: ${currentQty} \n` +
                                    `Total: ${totalAfterDelivery} \n\n` +
                                    `Excess: ${totalAfterDelivery - maxAllowedSO}`
                            });
                            setIsLoading(false);
                            return;
                        }

                        // Check 2: Production Quantity
                        if (totalAfterDelivery > totalProduced) {
                            setErrorModal({
                                open: true,
                                message: `Insufficient Production for ${productName || 'Product'}. \n\n` +
                                    `Total Produced: ${totalProduced} \n` +
                                    `Previously Delivered: ${alreadyDelivered} \n` +
                                    `Current: ${currentQty} \n` +
                                    `Total Required: ${totalAfterDelivery} \n\n` +
                                    `Shortage: ${totalAfterDelivery - totalProduced} \n\n` +
                                    `Please ask the Production team to enter more quantity.`
                            });
                            setIsLoading(false);
                            return;
                        }
                    }
                }
            }
        }
        const POCollection = section === 'finished_goods' ? 'fg_delivery_orders' : 'rm_purchase_orders';
        const ProdCollection = section === 'finished_goods' ? 'fg_products' : 'rm_products';

        try {
            // Process items - create new products if needed & Update UOMs
            const processedItems = await Promise.all(items.map(async (item) => {
                let productId = item.product_id

                // If product_id is not a known ID (it's a new string name)
                const isExistingProduct = products.some(p => p.id === productId);

                if (!isExistingProduct && productId.toString().trim() !== '') {
                    // Create new product logic
                    let targetCatId = ''

                    // Find category based on selected filter
                    const foundCat = categories.find(c => c.name === selectedCategory)
                    if (foundCat) {
                        targetCatId = foundCat.id
                    } else if (section === 'raw_material') {
                        // Default to General for Raw Material if no filter selected
                        let generalCat = categories.find(c => c.name === 'General')
                        if (!generalCat && categories.length > 0) generalCat = categories[0]
                        if (generalCat) targetCatId = generalCat.id
                    }

                    const newProduct = {
                        category_id: targetCatId,
                        description: productId,
                        uom: item.uom || '',
                        length: Number(item.length || 0),
                        width: Number(item.width || 0),
                        gsm: Number(item.gsm || 0),
                        min_stock_level: 0,
                        current_stock: 0,
                        rate: Number(item.rate || 0), // Set first usage rate
                        type: section,
                        createdAt: serverTimestamp()
                    }

                    const docRef = await addDoc(collection(db, ProdCollection), newProduct);
                    productId = docRef.id;
                } else if (isExistingProduct) {
                    // Check logic for Existing Product
                    const existingP = products.find(p => p.id === productId);
                    const pRef = doc(db, ProdCollection, productId);
                    const updates: any = {};
                    let shouldUpdate = false;

                    // 1. UOM Sync (If missing in DB)
                    if (item.uom && existingP && !existingP.uom) {
                        updates.uom = item.uom;
                        shouldUpdate = true;
                    }

                    // 2. Rate Sync (Lowest Wins Logic)
                    // If DB rate is 0 OR New Rate < DB Rate
                    // AND New Rate > 0
                    const newRate = Number(item.rate);
                    const currentDbRate = Number(existingP?.rate || 0);

                    if (newRate > 0) {
                        if (currentDbRate === 0 || newRate < currentDbRate) {
                            updates.rate = newRate;
                            shouldUpdate = true;
                            console.log(`Updating Rate for ${existingP?.description}: ${currentDbRate} -> ${newRate}`);
                        }
                    }

                    if (shouldUpdate) {
                        updates.updatedAt = serverTimestamp();
                        await updateDoc(pRef, updates);
                    }
                }

                // 3. PERSIST WEIGHT LOGIC (New Requirement)
                // If user edited calculated_kgs or changed decimal preference, save it to the product
                if (item.calculated_kgs > 0 && item.quantity > 0) {
                    const pRef = doc(db, ProdCollection, productId);
                    // Calculate Unit Weight: Total Weight / Total Qty
                    // This represents "Weight per 1 Qty" (whatever the Qty unit is)
                    const unitWeight = Number((item.calculated_kgs / item.quantity).toFixed(4)); // 4 decimals precision for unit weight

                    await updateDoc(pRef, {
                        unit_weight: unitWeight,
                        allow_decimals: item.allow_decimals !== undefined ? item.allow_decimals : true,
                        updatedAt: serverTimestamp()
                    });
                }

                const product = products.find(p => p.id === productId)
                let kgs = 0

                // Use the calculated_kgs from state if available (Paper Logic)
                // We trust the state because it's what the user sees/edits
                if (item.category === 'PAPER & BOARD' || (product && product.gsm > 0) || (item.length > 0 && item.width > 0 && item.gsm > 0)) {
                    kgs = Number(item.calculated_kgs || 0);
                    if (item.allow_decimals === false) {
                        kgs = Math.floor(kgs);
                    }
                }

                const line_total = kgs > 0 ? item.rate * kgs : item.rate * item.quantity

                return {
                    product_id: productId,
                    quantity: Number(item.quantity || 0),
                    rate: Number(item.rate || 0),
                    calculated_kgs: kgs, // Save the final used kgs
                    allow_decimals: item.allow_decimals !== undefined ? item.allow_decimals : true, // Persist decimal preference
                    line_total,
                    length: Number(item.length || 0),
                    width: Number(item.width || 0),
                    gsm: Number(item.gsm || 0),
                    uom: item.uom || '',
                    no_of_boxes: Number(item.no_of_boxes || 0),
                    qty_per_box: Number(item.qty_per_box || 0),
                    has_short_item: item.has_short_item || false,
                    short_no_of_boxes: Number(item.short_no_of_boxes || 0),
                    short_qty_per_box: Number(item.short_qty_per_box || 0),
                    category: item.category || '', // Persist item category
                    item_code: product ? (product.item_code || '') : '', // Persist item code for PDF
                    product_description: product ? product.description : productId
                }
            }))

            // Check for Sheet Size Mismatch (Paper & Board)
            let sheetSizeMismatch = false;
            if (section === 'raw_material' && selectedJobCard) {
                processedItems.forEach(item => {
                    if (item.category === 'PAPER & BOARD' || item.gsm > 0) {
                        const jcL = Number(selectedJobCard.phase2Data?.sheetSizeL || 0);
                        const jcW = Number(selectedJobCard.phase2Data?.sheetSizeW || 0);
                        const jcGsm = Number(selectedJobCard.phase2Data?.sheetSizeGsm || 0);

                        if (jcL !== item.length || jcW !== item.width || jcGsm !== item.gsm) {
                            sheetSizeMismatch = true;
                        }
                    }
                });
            }

            const subtotal = processedItems.reduce((sum, item) => sum + item.line_total, 0)
            const taxAmount = enableTax ? (subtotal * (taxRate / 100)) : 0

            const supplierName = suppliers.find(s => s.id === selectedSupplier)?.name || '';
            const existingId = initialData?.id;

            // If creating new, generate ID. If editing, keep ID.
            let poId = existingId;
            let orderNo = initialData?.order_no;

            if (!existingId) {
                // Generate Dynamic ID System for New POs
                // Format: PO-YYYY-NNN
                orderNo = await generateSeriesPOId(section);
                // We use this as doc ID too if possible, but Firestore allows custom IDs.
                // To keep it simple, we use this as doc ID.
                poId = orderNo;
            }

            // --- FG SYNC LOGIC: Deduct Stock & Add to Inventory ---
            if (section === 'finished_goods') {
                // 1. Deduct Stock from Products
                await Promise.all(processedItems.map(async (item) => {
                    const pRef = doc(db, ProdCollection, item.product_id);
                    const deductQty = -Math.abs(Number(item.quantity));
                    await updateDoc(pRef, { current_stock: increment(deductQty) });
                }));

                // 2. Add to Inventory Sheet
                // Identify Sheet (Month/Year from 'date')
                const d = new Date(date);
                const month = d.getMonth() + 1;
                const year = d.getFullYear();

                // Find existing sheet
                const sheetQuery = query(
                    collection(db, 'fg_inventory_sheets'),
                    where('month', '==', month),
                    where('year', '==', year),
                    where('section', '==', 'finished_goods')
                );
                const sheetSnap = await getDocs(sheetQuery);
                let sheetId = '';

                if (!sheetSnap.empty) {
                    sheetId = sheetSnap.docs[0].id;
                } else {
                    // Create new sheet
                    const newSheetRef = await addDoc(collection(db, 'fg_inventory_sheets'), {
                        month,
                        year,
                        section: 'finished_goods',
                        createdAt: serverTimestamp()
                    });
                    sheetId = newSheetRef.id;
                }

                // Add Transactions logic removed for Finished Goods. 
                // Transactions should only be created via "Add to Inventory" in the Delivery Orders view to prevent duplicates.
            } else if (section === 'raw_material') {
                // --- RM Warehouse Stock Update ---
                // For RM, we just save the PO with warehouse_id. 
                // Stock updates happen via 'Add Entry' (GRN).
            }

            // Conditional fields based on section
            const extraFields = section === 'finished_goods' ? {
                linked_po_id: linkedPO || null,
                vehicle_no: vehicleNo,
                driver_name: driverName,
                driver_mobile: driverMobile,
                destination: destination,
                ogp_no: ogpNo,
                has_sales_tax: hasSalesTax // Save the flag
            } : {
                grn_no: grnNo, // Only for RM
                job_card_id: selectedJobCardId || null,
                job_card_no: selectedJobCard?.jobCardNo || null,
                sheet_size_mismatch: sheetSizeMismatch,
                requires_approval: sheetSizeMismatch
            };

            const po = {
                supplier_id: selectedSupplier,
                supplier_name: supplierName,
                user_id: user?.uid || null,
                created_by: user?.username || user?.email || 'Unknown',
                date: date,
                // FIX: If FG and Editing, force status to 'Draft' so user must Re-Sync (Update Status)
                status: (section === 'finished_goods' && initialData) ? 'Draft' : 
                        (sheetSizeMismatch ? 'Pending Approval' : (initialData ? initialData.status : 'Draft')),
                items: processedItems,
                grand_total: subtotal + taxAmount + (section === 'raw_material' ? (freightAmount || 0) : 0),
                tax_rate: enableTax ? taxRate : 0,
                tax_amount: taxAmount,
                freight_amount: section === 'raw_material' ? (freightAmount || 0) : 0,
                type: section,
                category: selectedCategory, // Save the filter/category
                updatedAt: serverTimestamp(),
                // Vital: Reset synced status on Edit so it can be re-synced
                is_synced: 0,
                order_no: orderNo, // Save the friendly ID
                warehouse_id: section === 'raw_material' ? selectedWarehouse : null,
                warehouse_name: section === 'raw_material' ? warehouses.find(w => w.id === selectedWarehouse)?.name : null,
                sheet_size_mismatch: sheetSizeMismatch,
                ...extraFields
            }

            if (existingId) {
                const poRef = doc(db, POCollection, existingId);
                await updateDoc(poRef, po);
            } else {
                // Create with custom ID
                const poRef = doc(db, POCollection, poId);
                // Use setDoc to force the custom ID
                await import('firebase/firestore').then(({ setDoc }) => setDoc(poRef, {
                    ...po,
                    id: poId, // redundant but safe
                    createdAt: serverTimestamp()
                }));
            }

            // --- ADVANCE LINKED JOB CARD ---
            if (selectedJobCardId) {
                try {
                    const jcRef = doc(db, 'job_cards', selectedJobCardId);
                    const jcSnap = await getDoc(jcRef);
                    if (jcSnap.exists()) {
                        const jcData = jcSnap.data();
                        const currentPhase = jcData.currentPhase || 1;
                        const phaseStatuses = jcData.phaseStatuses || {};
                        const jobCardNo = jcData.jobCardNo || 'Unknown';

                        if (section === 'raw_material') {
                            // RM Logic: Phase 3 -> Phase 4
                            // RM Logic: Phase 3 -> Phase 4 (Only if Phase 3 is not yet completed)
                            if (phaseStatuses[3] !== 'completed') {
                                const newStatuses = { ...phaseStatuses };
                                newStatuses[3] = 'completed';
                                let newCurrentPhase = currentPhase;
                                if (currentPhase === 3) newCurrentPhase = 4;

                                await updateDoc(jcRef, {
                                    phaseStatuses: newStatuses,
                                    currentPhase: newCurrentPhase,
                                    status: 'production',
                                    updatedAt: serverTimestamp()
                                });

                                // Notify Phase 4
                                await sendJobCardNotifications(selectedJobCardId, jobCardNo, 4);
                            }
                        } else if (section === 'finished_goods') {
                            // FG Logic: Phase 7 (Only if Phase 7 is not yet completed)
                            const totalQty = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
                            const newLog = {
                                id: Date.now().toString(),
                                fgReceived: true,
                                deliveryDate: date,
                                deliveryChallanNo: orderNo,
                                deliveredQty: totalQty,
                                createdAt: new Date().toISOString()
                            };

                            const phase7Data = jcData.phase7Data || {};
                            const currentLogs = phase7Data.deliveryLogs || [];

                            const updates: any = {
                                'phase7Data.deliveryLogs': [...currentLogs, newLog],
                                updatedAt: serverTimestamp()
                            };

                            if (phaseStatuses[7] !== 'completed') {
                                updates['phaseStatuses.7'] = 'completed';
                                updates.currentPhase = 8;
                                updates.status = 'closure';
                            }

                            await updateDoc(jcRef, updates);

                            // Notify Phase 8 (Closure)
                            if (phaseStatuses[7] !== 'completed') {
                                await sendJobCardNotifications(selectedJobCardId, jobCardNo, 8);
                            }
                        }
                    }
                } catch (jcErr) {
                    console.error("Failed to update linked job card", jcErr);
                }
            }

            onSuccess()
        } catch (error: any) {
            console.error('Failed to save PO', error)
            setErrorModal({ open: true, message: `Error saving document: ${error.message}` })
        } finally {
            setIsLoading(false)
            setShowConfirm(false)
        }
    }




    // ... (rest of the component)

    return (
        <div className="p-4 bg-white rounded shadow relative">
            {isLoading && <LoadingOverlay />}

            <h2 className="text-xl font-bold mb-4">{initialData ? 'Edit' : 'New'} {section === 'finished_goods' ? 'Delivery Note' : 'Purchase Order'}</h2>
            <form onSubmit={handleSaveClick}>
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="flex flex-col">
                        <label className="block mb-2 font-bold text-gray-700">{section === 'finished_goods' ? 'Buyer' : 'Supplier'}</label>
                        <SearchableDropdown
                            options={suppliers.map(s => ({ id: s.id, label: s.name }))}
                            value={selectedSupplier}
                            onChange={(val) => setSelectedSupplier(val as string)}
                            placeholder={`Select ${section === 'finished_goods' ? 'Buyer' : 'Supplier'}`}
                        />
                    </div>
                    <div>
                        <label className="block mb-2 font-bold text-gray-700">Date</label>
                        <input
                            type="date"
                            className="w-full border p-2 rounded"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            required
                        />
                    </div>
                    {section === 'raw_material' && (
                        <div>
                            <label className="block mb-2 font-bold text-gray-700">GRN No <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={grnNo}
                                onChange={(e) => setGrnNo(e.target.value)}
                                placeholder="Goods Receipt Note Number"
                                required
                            />
                        </div>
                    )}
                    {section === 'raw_material' && (
                        <div>
                            <label className="block mb-2 font-bold text-gray-700">Warehouse <span className="text-red-500">*</span></label>
                            <select
                                className="w-full border p-2 rounded"
                                value={selectedWarehouse}
                                onChange={(e) => setSelectedWarehouse(e.target.value)}
                                required
                            >
                                <option value="">Select Warehouse</option>
                                {warehouses.map(w => (
                                    <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block mb-2 font-bold text-gray-700">
                            {section === 'finished_goods' ? 'Link Job Card' : 'Job Card (Optional)'}
                        </label>
                        <SearchableDropdown
                            options={jobCards.map(jc => ({ id: jc.id, label: jc.jobCardNo }))}
                            value={selectedJobCardId}
                            onChange={(val) => setSelectedJobCardId(val as string)}
                            placeholder={section === 'finished_goods' ? "Select Job Card" : "Select Job Card (Procurement Phase)"}
                        />
                        {selectedJobCard && section === 'raw_material' && (
                            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                                <span className="font-bold text-yellow-800">Required Sheet Size: </span>
                                {(selectedJobCard.phase2Data?.sheetSizeL || selectedJobCard.phase2Data?.sheetSizeW || selectedJobCard.phase2Data?.sheetSizeGsm) ? (
                                    <span className="font-semibold">
                                        L: {selectedJobCard.phase2Data.sheetSizeL || '-'}, 
                                        W: {selectedJobCard.phase2Data.sheetSizeW || '-'}, 
                                        GSM: {selectedJobCard.phase2Data.sheetSizeGsm || '-'}
                                    </span>
                                ) : (
                                    <span className="font-semibold text-gray-500 italic">
                                        {selectedJobCard.phase2Data?.sheetSize || 'No sheet size specified in Pre-Press'}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {section === 'finished_goods' && (
                    <div className="grid grid-cols-3 gap-4 mb-4 bg-blue-50 p-4 rounded">
                        <div className="flex flex-col">
                            <label className="block mb-2 font-bold text-gray-700">Linked PO (Sales Order)</label>
                            <SearchableDropdown
                                options={availablePOs.map(po => ({ id: po.po_no, label: po.po_no }))}
                                value={linkedPO}
                                onChange={(val) => setLinkedPO(val as string)}
                                placeholder={selectedSupplier ? "Select PO" : "Select Customer First"}
                                disabled={!selectedSupplier}
                            />
                        </div>
                        <div>
                            <label className="block mb-2 font-bold text-gray-700">Vehicle No</label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={vehicleNo}
                                onChange={(e) => setVehicleNo(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block mb-2 font-bold text-gray-700">Driver Name</label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={driverName}
                                onChange={(e) => setDriverName(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block mb-2 font-bold text-gray-700">Driver Mobile</label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={driverMobile}
                                onChange={(e) => setDriverMobile(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block mb-2 font-bold text-gray-700">Destination</label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={destination}
                                onChange={(e) => setDestination(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block mb-2 font-bold text-gray-700">OGP No</label>
                            <input
                                type="text"
                                className="w-full border p-2 rounded"
                                value={ogpNo}
                                onChange={(e) => setOgpNo(e.target.value)}
                            />
                        </div>
                    </div>
                )}

                {/* Sales Tax Checkbox for Finished Goods */}
                {
                    section === 'finished_goods' && (
                        <div className="mb-4 flex items-center gap-4 bg-gray-50 p-3 rounded border border-gray-200">
                            <label className="flex items-center gap-2 font-bold text-gray-700 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={hasSalesTax}
                                    onChange={(e) => setHasSalesTax(e.target.checked)}
                                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                                />
                                Apply Sales Tax? (Affects Print Format)
                            </label>
                        </div>
                    )
                }

                {
                    section === 'raw_material' && (
                        <div className="mb-4 flex items-center gap-4 bg-gray-50 p-3 rounded">
                            <label className="font-bold text-gray-700">Freight Amount (Rs.)</label>
                            <input
                                type="number"
                                step="0.01"
                                className="border p-2 rounded w-32 font-bold"
                                value={freightAmount || ''}
                                onChange={(e) => setFreightAmount(Number(e.target.value))}
                                placeholder="0.00"
                            />
                        </div>
                    )
                }

                {/* Tax Section - Hide for Finished Goods */}
                {
                    section !== 'finished_goods' && (
                        <div className="mb-4 flex items-center gap-4 bg-gray-50 p-3 rounded">
                            <label className="flex items-center gap-2 font-bold text-gray-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={enableTax}
                                    onChange={(e) => setEnableTax(e.target.checked)}
                                    className="w-5 h-5"
                                />
                                Apply Sales Tax (GST)
                            </label>
                            {enableTax && (
                                <select
                                    value={taxRate}
                                    onChange={(e) => setTaxRate(Number(e.target.value))}
                                    className="border p-2 rounded font-bold"
                                >
                                    <option value={16}>16%</option>
                                    <option value={18}>18%</option>
                                </select>
                            )}
                        </div>
                    )
                }

                <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="font-bold text-lg">Items</h3>
                    </div>

                    <div className="flex gap-2 mb-2 font-bold text-sm text-gray-600">
                        <div className="w-32">Category</div>
                        <div className="flex-1">Product / Item Name</div>
                        {section !== 'finished_goods' && <div className="w-16">UOM</div>}
                        {/* Show Paper Columns if Global Category is Paper OR Any Item is Paper */}
                        {section === 'raw_material' && isPaperCategory && (
                            <>
                                <div className="w-16">L</div>
                                <div className="w-16">W</div>
                                <div className="w-16">GSM</div>
                                <div className="w-24">Weight (Kg)</div>
                            </>
                        )}
                        {section === 'finished_goods' && (
                            <>
                                <div className="w-24">No. Boxes</div>
                                <div className="w-24">Qty/Box</div>
                            </>
                        )}
                        <div className="w-24">Quantity</div>
                        {section !== 'finished_goods' && <div className="w-24">Rate</div>}
                        {section !== 'finished_goods' && <div className="w-24">Total</div>}
                        <div className="w-8"></div>
                    </div>
                    {items.map((item, index) => (
                        <div key={index} className="flex gap-2 mb-2 items-start">
                            {/* Per-Row Category Selection */}
                            <div className="w-32">
                                <select
                                    className="border p-2 rounded w-full text-sm"
                                    value={item.category || ''}
                                    onChange={(e) => {
                                        updateItem(index, 'category', e.target.value);
                                        // Clear product if category changes? Maybe better UX to keep if valid, but safer to clear or warn.
                                        // keeping it simple: just update category. Product validation happens visually.
                                    }}
                                    disabled={section === 'finished_goods'} // Disable manual category selection for FG
                                >
                                    <option value="">All</option>
                                    {/* Use filteredCategories (based on PO) if FG, else all categories */}
                                    {filteredCategories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                </select>
                            </div>

                            <div className="flex-1 relative">
                                <input
                                    list={`products-list-${index}`}
                                    className="border p-2 rounded w-full"
                                    value={products.find(p => p.id === item.product_id)?.description || item.product_id}
                                    onChange={(e) => {
                                        const val = e.target.value
                                        const product = products.find(p => p.description === val)
                                        updateItem(index, 'product_id', product ? product.id : val)
                                        if (product) {
                                            // Auto-select category
                                            if (product.category_name) {
                                                // Force update if FG, or if empty (Regular logic)
                                                if (section === 'finished_goods' || !item.category) {
                                                    updateItem(index, 'category', product.category_name);
                                                }
                                            }

                                            if (item.category === 'PAPER & BOARD' || product.category_name === 'PAPER & BOARD' || product.gsm > 0) {
                                                updateItem(index, 'length', product.length)
                                                updateItem(index, 'width', product.width)
                                                updateItem(index, 'gsm', product.gsm)
                                            }
                                            // Auto-fill UOM and Rate
                                            if (product.uom) updateItem(index, 'uom', product.uom)
                                            if (product.rate !== undefined && product.rate !== null) updateItem(index, 'rate', product.rate)

                                            // Auto-fill qty_per_box from production history (FG DN only)
                                            if (section === 'finished_goods') {
                                                const qtyOptions = productionQtyMap[product.id] || [];
                                                if (qtyOptions.length === 1) {
                                                    // Only one value → auto-fill
                                                    updateItem(index, 'qty_per_box', qtyOptions[0]);
                                                    const boxes = item.no_of_boxes || 0;
                                                    const shortBoxes = item.short_no_of_boxes || 0;
                                                    updateItem(index, 'quantity', boxes * qtyOptions[0] + shortBoxes * (item.short_qty_per_box || 0));
                                                } else {
                                                    // Multiple or none → clear, user picks from datalist
                                                    updateItem(index, 'qty_per_box', '');
                                                }
                                            }
                                        }
                                    }}
                                    placeholder="Select Item..."
                                    required
                                    autoComplete="off"
                                    disabled={section === 'finished_goods' && !linkedPO} // Lock if no PO selected for FG
                                />
                                <datalist id={`products-list-${index}`}>
                                    {products.filter(p => {
                                        // 1. Filter by Linked PO (FG only)
                                        if (section === 'finished_goods' && linkedPO) {
                                            const poTrans = transactions.filter(t => t.po_no === linkedPO);
                                            const validNames = new Set(poTrans.map(t => t.product_name));
                                            if (!validNames.has(p.description)) return false;
                                        }
                                        // 2. Filter by Row Category
                                        if (item.category) {
                                            // Find category obj
                                            const cat = categories.find(c => c.name === item.category);
                                            if (cat && p.category_id !== cat.id) return false;
                                        }
                                        return true;
                                    }).map(p => <option key={p.id} value={p.description} />)}
                                </datalist>
                            </div>

                            {section !== 'finished_goods' && (
                                <>
                                    <input
                                        list={`uom-list-${index}`}
                                        placeholder="UOM"
                                        className="border p-2 rounded w-16"
                                        value={item.uom || ''}
                                        onChange={(e) => updateItem(index, 'uom', e.target.value)}
                                        required
                                    />
                                    <datalist id={`uom-list-${index}`}>
                                        {uoms.map((u, i) => <option key={i} value={u} />)}
                                    </datalist>
                                </>
                            )}

                            {/* Dimensions Columns (Show if isPaperCategory is true - implies alignment needed) */}
                            {(isPaperCategory && section === 'raw_material') && (
                                <>
                                    {/* If this specific item is Paper, show inputs. Else show placeholders to maintain alignment. */}
                                    {(item.category === 'PAPER & BOARD' || item.gsm > 0) ? (
                                        <>
                                            <input
                                                type="number" placeholder="L" className="border p-2 rounded w-16"
                                                value={item.length || ''} onChange={(e) => updateItem(index, 'length', Number(e.target.value))}
                                            />
                                            <input
                                                type="number" placeholder="W" className="border p-2 rounded w-16"
                                                value={item.width || ''} onChange={(e) => updateItem(index, 'width', Number(e.target.value))}
                                            />
                                            <input
                                                type="number" placeholder="GSM" className="border p-2 rounded w-16"
                                                value={item.gsm || ''} onChange={(e) => updateItem(index, 'gsm', Number(e.target.value))}
                                            />
                                            {/* Weight & Decimal Checkbox */}
                                                <div className="flex flex-col w-24">
                                                    <input
                                                        type="number"
                                                        placeholder="Kg"
                                                        className="border p-1 rounded w-full text-sm font-bold bg-blue-50 text-blue-800"
                                                        value={item.calculated_kgs || ''}
                                                        onChange={(e) => updateItem(index, 'calculated_kgs', Number(e.target.value))}
                                                    />
                                                    <label className="flex items-center gap-1 mt-1 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={item.allow_decimals !== false} // Default true
                                                            onChange={(e) => updateItem(index, 'allow_decimals', e.target.checked)}
                                                            className="w-3 h-3"
                                                        />
                                                        <span className="text-[10px] text-gray-500 leading-tight">Decimals?</span>
                                                    </label>
                                                </div>

                                                {/* Required Reference from Job Card */}
                                                {selectedJobCard && (
                                                    <div className="col-span-4 mt-1 bg-yellow-50 p-1 rounded border border-yellow-200">
                                                        <span className="text-[9px] font-bold text-yellow-700">Required: </span>
                                                        <span className="text-[9px] text-yellow-800">
                                                            {selectedJobCard.phase2Data?.sheetSizeL || '-'} x {selectedJobCard.phase2Data?.sheetSizeW || '-'} x {selectedJobCard.phase2Data?.sheetSizeGsm || '-'}
                                                        </span>
                                                        {(Number(selectedJobCard.phase2Data?.sheetSizeL) !== Number(item.length) || 
                                                          Number(selectedJobCard.phase2Data?.sheetSizeW) !== Number(item.width) || 
                                                          Number(selectedJobCard.phase2Data?.sheetSizeGsm) !== Number(item.gsm)) && (
                                                            <span className="text-[9px] font-bold text-red-600 ml-2"> (Mismatch!)</span>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                    ) : (
                                        /* Spacers for Non-Paper Items */
                                        <>
                                            <div className="w-16 border p-2 rounded bg-gray-50 text-center text-gray-300">-</div>
                                            <div className="w-16 border p-2 rounded bg-gray-50 text-center text-gray-300">-</div>
                                            <div className="w-16 border p-2 rounded bg-gray-50 text-center text-gray-300">-</div>
                                            <div className="w-24 border p-2 rounded bg-gray-50 text-center text-gray-300">-</div>
                                        </>
                                    )}
                                </>
                            )}

                            {section === 'finished_goods' && (
                                <div className="flex flex-col gap-1">
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            placeholder="Boxes"
                                            className="border p-2 rounded w-24"
                                            value={item.no_of_boxes || ''}
                                            onChange={(e) => {
                                                const boxes = Number(e.target.value)
                                                updateItem(index, 'no_of_boxes', boxes)
                                                // Calculate Total: (Main Boxes * Main Qty/Box) + (Short Boxes * Short Qty/Box)
                                                const mainQty = boxes * (item.qty_per_box || 0)
                                                const shortQty = (item.short_no_of_boxes || 0) * (item.short_qty_per_box || 0)
                                                updateItem(index, 'quantity', mainQty + shortQty)
                                            }}
                                        />
                                        <div className="flex flex-col gap-0.5 w-24">
                                            <input
                                                list={`qtyperbox-list-${index}`}
                                                placeholder="Qty/Box"
                                                className="border p-2 rounded w-24"
                                                value={item.qty_per_box || ''}
                                                onChange={(e) => {
                                                    const raw = e.target.value.replace(/,/g, '');
                                                    const qtyPerBox = Number(raw);
                                                    updateItem(index, 'qty_per_box', isNaN(qtyPerBox) ? 0 : qtyPerBox)
                                                    // Recalculate Total
                                                    const mainQty = (item.no_of_boxes || 0) * qtyPerBox
                                                    const shortQty = (item.short_no_of_boxes || 0) * (item.short_qty_per_box || 0)
                                                    updateItem(index, 'quantity', mainQty + shortQty)
                                                }}
                                            />
                                            <datalist id={`qtyperbox-list-${index}`}>
                                                {(productionQtyMap[item.product_id] || []).map((q: number) => (
                                                    <option key={q} value={q} />
                                                ))}
                                            </datalist>
                                            {(productionQtyMap[item.product_id] || []).length > 1 && (
                                                <span className="text-[10px] text-blue-600 font-semibold">
                                                    {(productionQtyMap[item.product_id] || []).length} options from production
                                                </span>
                                            )}
                                            {(productionQtyMap[item.product_id] || []).length === 0 && item.product_id && (
                                                <span className="text-[10px] text-gray-400">No production history</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Short Item Checkbox & Inputs */}
                                    <div>
                                        <label className="flex items-center gap-1 text-xs font-bold text-gray-600">
                                            <input
                                                type="checkbox"
                                                checked={item.has_short_item || false}
                                                onChange={(e) => {
                                                    const checked = e.target.checked;
                                                    updateItem(index, 'has_short_item', checked);
                                                    if (!checked) {
                                                        // Reset short values if unchecked
                                                        updateItem(index, 'short_no_of_boxes', 0);
                                                        updateItem(index, 'short_qty_per_box', 0);
                                                        // Recalculate Qty
                                                        const mainQty = (item.no_of_boxes || 0) * (item.qty_per_box || 0);
                                                        updateItem(index, 'quantity', mainQty);
                                                    }
                                                }}
                                            />
                                            Short Item?
                                        </label>

                                        {item.has_short_item && (
                                            <div className="flex gap-1 mt-1">
                                                <input
                                                    type="number"
                                                    placeholder="S. Boxes"
                                                    className="border p-1 rounded w-20 text-xs border-orange-300 bg-orange-50"
                                                    value={item.short_no_of_boxes || ''}
                                                    onChange={(e) => {
                                                        const sBoxes = Number(e.target.value);
                                                        updateItem(index, 'short_no_of_boxes', sBoxes);
                                                        const mainQty = (item.no_of_boxes || 0) * (item.qty_per_box || 0);
                                                        const shortQty = sBoxes * (item.short_qty_per_box || 0);
                                                        updateItem(index, 'quantity', mainQty + shortQty);
                                                    }}
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="S. Qty/Box"
                                                    className="border p-1 rounded w-20 text-xs border-orange-300 bg-orange-50"
                                                    value={item.short_qty_per_box || ''}
                                                    onChange={(e) => {
                                                        const sQtyPerBox = Number(e.target.value);
                                                        updateItem(index, 'short_qty_per_box', sQtyPerBox);
                                                        const mainQty = (item.no_of_boxes || 0) * (item.qty_per_box || 0);
                                                        const shortQty = (item.short_no_of_boxes || 0) * sQtyPerBox;
                                                        updateItem(index, 'quantity', mainQty + shortQty);
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <input
                                type="text"
                                placeholder="Qty"
                                className={`border p-2 rounded w-24 text-right font-bold ${section === 'finished_goods' ? 'bg-gray-100' : ''}`}
                                value={item.quantity != null && item.quantity !== '' ? Number(item.quantity).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : ''}
                                onChange={(e) => {
                                    if (section !== 'finished_goods') {
                                        const raw = Number(e.target.value.replace(/,/g, ''));
                                        updateItem(index, 'quantity', isNaN(raw) ? 0 : raw);
                                    }
                                }}
                                required
                                readOnly={section === 'finished_goods'}
                            />
                            {section !== 'finished_goods' && (
                                <input
                                    type="number"
                                    placeholder="Rate"
                                    className="border p-2 rounded w-24"
                                    value={item.rate}
                                    onChange={(e) => updateItem(index, 'rate', Number(e.target.value))}
                                    required
                                />
                            )}
                            {section !== 'finished_goods' && (
                                <input
                                    type="text"
                                    className="border p-2 rounded w-24 bg-gray-100 text-right font-bold"
                                    value={(() => {
                                        let kgs = 0;
                                        // Use the calculated_kgs directly if available (Paper), else standard logic? 
                                        // Actually for Paper, we MUST use calculated_kgs from state now.

                                        if (isPaperCategory || item.category === 'PAPER & BOARD' || (item.gsm > 0 && item.length > 0)) {
                                            // Paper Logic
                                            kgs = Number(item.calculated_kgs || 0);
                                            // Handle Decimals Logic
                                            if (item.allow_decimals === false) {
                                                kgs = Math.floor(kgs); // Ignore decimals -> Floor
                                            }
                                        }

                                        // Total Calculation
                                        let total = 0;
                                        if (kgs > 0) {
                                            total = (item.rate || 0) * kgs;
                                        } else {
                                            // Standard Item (Qty * Rate)
                                            total = (item.rate || 0) * (item.quantity || 0);
                                        }

                                        return total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                    })()}
                                    readOnly
                                    disabled
                                />
                            )}
                            <button type="button" onClick={() => removeItem(index)} className="text-red-500 font-bold text-xl px-2">×</button>
                        </div>
                    ))}
                    <button
                        type="button"
                        onClick={addItem}
                        className={`font-bold text-xl px-2 ${section === 'finished_goods' && !linkedPO ? 'text-gray-400 cursor-not-allowed' : 'text-blue-600 hover:text-blue-800'}`}
                        disabled={section === 'finished_goods' && !linkedPO}
                    >
                        + Add Item
                    </button>
                </div>

                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onCancel} className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50">Cancel</button>
                    <button type="submit" className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-700 font-bold shadow-sm">
                        {section === 'finished_goods' ? 'Create DN' : 'Create PO'}
                    </button>
                </div>
            </form >

            <ConfirmationModal
                isOpen={showConfirm}
                title={`Confirm ${section === 'finished_goods' ? 'Delivery Note' : 'Purchase Order'}`}
                message={`Are you sure you want to create this ${section === 'finished_goods' ? 'Delivery Note' : 'Purchase Order'}?`}
                onConfirm={executeSave}
                onCancel={() => setShowConfirm(false)}
                confirmText="Create"
            />

            {
                errorModal.open && (
                    <ConfirmationModal
                        isOpen={errorModal.open}
                        title="Error"
                        message={errorModal.message}
                        onConfirm={() => setErrorModal({ ...errorModal, open: false })}
                        onCancel={() => setErrorModal({ ...errorModal, open: false })}
                        confirmText="OK"
                        cancelText="Close"
                        isDangerous={true}
                    />
                )
            }
        </div >
    )
}