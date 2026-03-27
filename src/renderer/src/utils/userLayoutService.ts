import { db } from '../firebase';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

export const saveUserLayout = async (userId: string, gridId: string, colState: any[]) => {
    if (!userId || !gridId) return;
    const layoutRef = doc(db, 'user_column_layouts', `${userId}_${gridId}`);
    await setDoc(layoutRef, {
        userId,
        gridId,
        colState,
        updatedAt: new Date()
    }, { merge: true });
};

export const getUserLayout = async (userId: string, gridId: string) => {
    if (!userId || !gridId) return null;
    const layoutRef = doc(db, 'user_column_layouts', `${userId}_${gridId}`);
    const snap = await getDoc(layoutRef);
    if (snap.exists()) {
        return snap.data().colState;
    }
    return null;
};

export const resetUserLayout = async (userId: string, gridId: string) => {
    if (!userId || !gridId) return;
    const layoutRef = doc(db, 'user_column_layouts', `${userId}_${gridId}`);
    await deleteDoc(layoutRef);
};
