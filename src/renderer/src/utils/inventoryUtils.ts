import { db } from '../firebase';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';

export const getSuppliersForProduct = async (productId: string, productName: string, section: string = 'raw_material') => {
    const relevant = new Set<string>();
    const poColl = section === 'finished_goods' ? 'fg_delivery_orders' : 'rm_purchase_orders';
    const transColl = section === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions';

    // 1. Check POs/DOs
    try {
        const poSnap = await getDocs(collection(db, poColl));
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

    // 2. Check Inventory Transactions (Opening)
    try {
        const q = query(
            collection(db, transColl),
            where('product_id', '==', productId),
            where('transaction_type', '==', 'Opening')
        );
        const transSnap = await getDocs(q);
        transSnap.docs.forEach(d => {
            const s = d.data().supplier_name || d.data().manual_supplier_name;
            if (s) relevant.add(s);
        });

    } catch (e) { console.error("Error fetching Transactions for supplier lookup", e); }

    return Array.from(relevant);
};

export const fetchProductStock = async (productId: string, supplierName?: string, warehouseId?: string, section: string = 'raw_material') => {
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
        } else {
            // Global Stock
            const prodRef = doc(db, prodColl, productId);
            const snap = await getDoc(prodRef);
            if (snap.exists()) stock = snap.data().current_stock || 0;
        }
        return stock;
    } catch (e) {
        console.error('Error fetching stock:', e);
        return 0;
    }
};
