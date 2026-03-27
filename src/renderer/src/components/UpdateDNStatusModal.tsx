import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
    collection,
    doc,
    query,
    where,
    getDocs,
    writeBatch,
    serverTimestamp,
    increment,
    addDoc
} from 'firebase/firestore';

interface UpdateDNStatusModalProps {
    isOpen: boolean;
    onClose: () => void;
    grnNo: string; // This corresponds to the Order No / DN No (e.g. EC|26-27|001)
    sheetId?: string; // Optional: If not provided, we might need to find/create a return sheet
}

export const UpdateDNStatusModal: React.FC<UpdateDNStatusModalProps> = ({ isOpen, onClose, grnNo, sheetId }) => {
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        if (isOpen && grnNo) {
            fetchItems();
        }
    }, [isOpen, grnNo]);

    const fetchItems = async () => {
        setLoading(true);
        try {
            console.log("Fetching items for DN:", grnNo);
            // Query transactions by 'grn_no' (which stores the DN Number)
            // We remove sheet_id constraint to allow finding it from Global List (PurchaseOrders)
            const q = query(
                collection(db, 'fg_inventory_transactions'),
                where('grn_no', '==', grnNo),
                where('transaction_type', '==', 'Delivery Note')
            );
            const snap = await getDocs(q);
            console.log("Fetch Results:", snap.docs.length, "docs found");

            const data = snap.docs.map(d => {
                const docData = d.data();
                return {
                    id: d.id,
                    ...docData,
                    // Initialize accepted/rejected if not set
                    accepted_qty: docData.accepted_qty !== undefined ? docData.accepted_qty : Math.abs(docData.quantity),
                    rejected_qty: docData.rejected_qty !== undefined ? docData.rejected_qty : 0,
                    // Track original rejected qty for delta calculation to avoid double counting
                    original_rejected_qty: docData.rejected_qty !== undefined ? docData.rejected_qty : 0,
                    status: docData.dn_status || 'Pending'
                };
            });
            setItems(data);
        } catch (e) {
            console.error("Error fetching DN items:", e);
        } finally {
            setLoading(false);
        }
    };

    const handleQtyChange = (id: string, field: 'accepted_qty' | 'rejected_qty', value: string) => {
        const val = Number(value);
        setItems(prev => prev.map(item => {
            if (item.id !== id) return item;
            const originalQty = Math.abs(item.quantity);

            if (field === 'rejected_qty') {
                const newRejected = val;
                const newAccepted = originalQty - newRejected;
                return { ...item, rejected_qty: newRejected, accepted_qty: newAccepted };
            } else {
                const newAccepted = val;
                const newRejected = originalQty - newAccepted;
                return { ...item, accepted_qty: newAccepted, rejected_qty: newRejected };
            }
        }));
    };

    const handleConfirm = async () => {
        setProcessing(true);
        try {
            const batch = writeBatch(db);

            // 1. Fetch the Parent Delivery Order to update its items
            const doQuery = query(collection(db, 'fg_delivery_orders'), where('order_no', '==', grnNo));
            const doSnap = await getDocs(doQuery);
            let doRef: any = null;
            let doData: any = null;
            let doItems: any[] = [];

            if (!doSnap.empty) {
                doRef = doSnap.docs[0].ref;
                doData = doSnap.docs[0].data();
                doItems = [...(doData.items || [])];
            }

            items.forEach(item => {
                const transRef = doc(db, 'fg_inventory_transactions', item.id);
                const acceptedQty = Number(item.accepted_qty);
                const rejectedQty = Number(item.rejected_qty);
                const originalRejectedQty = Number(item.original_rejected_qty || 0);

                // 2. Update Status and Quantity of Original Transaction
                // Quantity in transactions is stored as NEGATIVE for DNs (Stock Out). 
                // We reduce the magnitude of the outflow (e.g. -100 becomes -90).
                const status = rejectedQty > 0 ? 'Rejected' : 'Confirmed';

                batch.update(transRef, {
                    dn_status: status,
                    quantity: -Math.abs(acceptedQty), // Update to actual accepted quantity (negative)
                    accepted_qty: acceptedQty,
                    rejected_qty: rejectedQty,
                    updatedAt: serverTimestamp()
                });

                // 3. Update Parent DO Item Quantity
                if (doItems.length > 0) {
                    // Find matching item in DO items. Matching by product_id should be safe.
                    const doItemIndex = doItems.findIndex((i: any) => i.product_id === item.product_id);
                    if (doItemIndex !== -1) {
                        // Update quantity to accepted quantity
                        doItems[doItemIndex].quantity = acceptedQty;
                        // Store rejected info in the DO item too
                        doItems[doItemIndex].rejected_qty = rejectedQty;
                    }
                }

                // 4. Increment Stock Back (Global) but ONLY for the DELTA
                // We compare new rejected qty vs original rejected qty.
                // Example: Rejected 0 -> 10. Delta +10. Stock +10.
                // Example: Rejected 10 -> 20. Delta +10. Stock +10.
                // Example: Rejected 10 -> 5. Delta -5. Stock -5.
                const stockAdjustment = rejectedQty - originalRejectedQty;

                if (stockAdjustment !== 0 && item.product_id) {
                    const prodRef = doc(db, 'fg_products', item.product_id);
                    batch.update(prodRef, {
                        current_stock: increment(stockAdjustment), // Add/Sub the difference
                        updatedAt: serverTimestamp()
                    });
                }
            });

            // 5. Commit DO Updates
            if (doRef && doItems.length > 0) {
                batch.update(doRef, {
                    items: doItems,
                    status: 'Delivered', // Ensure status stays/updates
                    updatedAt: serverTimestamp()
                });
            }

            await batch.commit();
            onClose();
        } catch (e: any) {
            console.error("Error updating DN status:", e);
            alert("Failed to update status. " + (e.message || e));
        } finally {
            setProcessing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-[250] backdrop-blur-sm">
            <div className="bg-white rounded-lg shadow-xl w-[900px] max-h-[90vh] flex flex-col animate-in fade-in zoom-in duration-200">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
                    <h3 className="font-bold text-lg text-gray-800">Update Delivery Note Status (DN: {grnNo})</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 font-bold text-xl">&times;</button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {loading ? (
                        <div className="flex justify-center p-8"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div></div>
                    ) : (
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    <th className="p-3 border-b">Product</th>
                                    <th className="p-3 border-b">Sent Qty</th>
                                    <th className="p-3 border-b">Rejected Qty</th>
                                    <th className="p-3 border-b">Accepted Qty</th>
                                    <th className="p-3 border-b">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {items.map(item => (
                                    <tr key={item.id} className="hover:bg-gray-50">
                                        <td className="p-3 text-sm text-gray-800">{item.product_name}</td>
                                        <td className="p-3 text-sm font-medium">{Math.abs(item.quantity)}</td>
                                        <td className="p-3">
                                            <input
                                                type="number"
                                                min="0"
                                                max={Math.abs(item.quantity)}
                                                value={item.rejected_qty}
                                                onChange={(e) => handleQtyChange(item.id, 'rejected_qty', e.target.value)}
                                                className="w-24 p-1 border rounded text-red-600 font-bold focus:ring-2 focus:ring-red-500 outline-none"
                                            />
                                        </td>
                                        <td className="p-3">
                                            <input
                                                type="number"
                                                value={item.accepted_qty}
                                                disabled
                                                className="w-24 p-1 border rounded bg-gray-100 text-gray-500"
                                            />
                                        </td>
                                        <td className="p-3 text-xs">
                                            <span className={`px-2 py-1 rounded-full ${item.status === 'Confirmed' ? 'bg-green-100 text-green-800' : item.status === 'Rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                                {item.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="p-4 border-t bg-gray-50 rounded-b-lg flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={processing || loading}
                        className={`px-4 py-2 text-white rounded font-bold shadow-sm ${processing ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        {processing ? 'Processing...' : 'Confirm Status Update'}
                    </button>
                </div>
            </div>
        </div>
    );
};
