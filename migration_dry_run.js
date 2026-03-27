(async () => {
    const W1_CORRECT = '3yEbnDm5QXEbLVZVFrCd';
    const W2_CORRECT = 'Ppiu8bhYDu9wQmQCCKbl';

    // Import Firebase modules from CDN
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
    const { getFirestore, collection, getDocs, doc, getDoc, query, where } = await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js");

    const firebaseConfig = {
        apiKey: "AIzaSyBRf2TlMB_5hTPyB6u4iyMBWcQUczb5JwA",
        authDomain: "excelinventorymanagement.firebaseapp.com",
        projectId: "excelinventorymanagement",
        storageBucket: "excelinventorymanagement.firebasestorage.app",
        messagingSenderId: "111357275790",
        appId: "1:111357275790:web:bd52c1394f13c85a21e3df"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const report = {
        transactions: [],
        purchase_orders: [],
        product_stocks: [],
        orphaned_ids: new Set()
    };

    console.log("--- Starting Dry Run Migration Scan ---");

    // 1. Scan RM Transactions
    console.log("Scanning rm_inventory_transactions...");
    const transSnap = await getDocs(collection(db, "rm_inventory_transactions"));
    transSnap.forEach(d => {
        const t = d.data();
        let needsUpdate = false;

        const check = (id, name, fieldName) => {
            if (!id || !name) return;
            const correctId = name.includes("Warehouse 1") ? W1_CORRECT : (name.includes("Warehouse 2") ? W2_CORRECT : null);
            if (correctId && id !== correctId) {
                report.orphaned_ids.add(id);
                return true;
            }
            return false;
        };

        if (check(t.warehouse_id, t.warehouse_name, 'warehouse_id')) needsUpdate = true;
        if (check(t.source_warehouse_id, t.source_warehouse_name, 'source_warehouse_id')) needsUpdate = true;
        if (check(t.dest_warehouse_id, t.dest_warehouse_name, 'dest_warehouse_id')) needsUpdate = true;

        if (needsUpdate) {
            report.transactions.push({ id: d.id, name: t.warehouse_name || t.product_name, old_id: t.warehouse_id });
        }
    });

    // 2. Scan RM Purchase Orders
    console.log("Scanning rm_purchase_orders...");
    const poSnap = await getDocs(collection(db, "rm_purchase_orders"));
    poSnap.forEach(d => {
        const po = d.data();
        const correctId = po.warehouse_name?.includes("Warehouse 1") ? W1_CORRECT : (po.warehouse_name?.includes("Warehouse 2") ? W2_CORRECT : null);
        if (correctId && po.warehouse_id !== correctId) {
            report.purchase_orders.push({ id: d.id, order_no: po.order_no, old_id: po.warehouse_id });
            report.orphaned_ids.add(po.warehouse_id);
        }
    });

    // 3. Scan Product Stocks
    console.log("Scanning rm_products stock subcollections...");
    const prodSnap = await getDocs(collection(db, "rm_products"));
    for (const pDoc of prodSnap.docs) {
        const stockSnap = await getDocs(collection(db, "rm_products", pDoc.id, "warehouse_stock"));
        stockSnap.forEach(sDoc => {
            if (sDoc.id !== W1_CORRECT && sDoc.id !== W2_CORRECT) {
                report.product_stocks.push({
                    product_id: pDoc.id,
                    product_name: pDoc.data().description,
                    ghost_id: sDoc.id,
                    stock: sDoc.data().current_stock
                });
                report.orphaned_ids.add(sDoc.id);
            }
        });
    }

    console.log("--- DRY RUN RESULTS ---");
    console.log(`Found ${report.transactions.length} transactions needing correction.`);
    console.log(`Found ${report.purchase_orders.length} purchase orders needing correction.`);
    console.log(`Found ${report.product_stocks.length} ghost stock records to be merged.`);
    console.log(`Orphaned IDs identified:`, Array.from(report.orphaned_ids));
    console.log("Detailed Product Stock Merges:", JSON.stringify(report.product_stocks, null, 2));

    return report;
})();
