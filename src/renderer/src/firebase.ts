import { initializeApp } from 'firebase/app';
import {
    getFirestore,
    enableIndexedDbPersistence
} from 'firebase/firestore';
import {
    getAuth,
    setPersistence,
    browserLocalPersistence
} from 'firebase/auth';

// --- PASTE YOUR FIREBASE CONFIG HERE ---
// Make sure these match your project exactly
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
const auth = getAuth(app);

// Enable Offline Persistence
// Enable Offline Persistence
// Enable Offline Persistence
// enableIndexedDbPersistence(db).catch((err) => {
//     if (err.code == 'failed-precondition') {
//         console.error('Persistence failed: Multiple tabs open.');
//     } else if (err.code == 'unimplemented') {
//         console.error('Persistence is not available in this browser.');
//     }
// });

// Enable Offline Auth Persistence
setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.error("Auth persistence error:", error);
});

export { db, auth };