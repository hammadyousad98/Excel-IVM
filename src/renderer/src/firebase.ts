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
import { getStorage } from 'firebase/storage';

// --- PASTE YOUR FIREBASE CONFIG HERE ---
// Make sure these match your project exactly
const firebaseConfig = {
    apiKey: "AIzaSyBRf2TlMB_5hTPyB6u4iyMBWcQUczb5JwA",
    authDomain: "excelinventorymanagement.firebaseapp.com",
    projectId: "excelinventorymanagement",
    storageBucket: "excelinventorymanagement.appspot.com",
    messagingSenderId: "111357275790",
    appId: "1:111357275790:web:bd52c1394f13c85a21e3df"
};
// const firebaseConfig = {
//     apiKey: "AIzaSyClzHUHbP9EbRQ8giDGjNxCSI1jWx2bAtE",
//     authDomain: "testing-ims-a1e1a.firebaseapp.com",
//     projectId: "testing-ims-a1e1a",
//     storageBucket: "testing-ims-a1e1a.firebasestorage.app",
//     messagingSenderId: "850937833323",
//     appId: "1:850937833323:web:20da7a0fa4be7ef36e8e2e",
//     measurementId: "G-DX01QDVBX4"
// };

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app, "gs://excelinventorymanagement.appspot.com");

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

export { db, auth, storage };