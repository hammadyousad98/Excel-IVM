
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where, limit, orderBy } = require('firebase/firestore');

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

async function checkTransactions() {
    console.log("Checking last 5 FG Delivery Note transactions...");
    try {
        const q = query(
            collection(db, 'fg_inventory_transactions'),
            where('transaction_type', '==', 'Delivery Note'),
            // orderBy('createdAt', 'desc'), // Might need an index, so let's try without sort first or handle index error
            limit(5)
        );

        const snap = await getDocs(q);
        if (snap.empty) {
            console.log("No FG Delivery Notes found.");
            return;
        }

        snap.forEach(doc => {
            const data = doc.data();
            console.log(`ID: ${doc.id}`);
            console.log(`  GRN No: ${data.grn_no}`);
            console.log(`  OGP No: ${data.ogp_no}`); // Check if this exists
            console.log(`  Transaction Type: ${data.transaction_type}`);
            console.log(`  PO No: ${data.po_no}`);
            console.log('-----------------------------------');
        });
    } catch (e) {
        console.error("Error:", e);
    }
}

checkTransactions();
