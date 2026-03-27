import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

interface TransferModalProps {
    isOpen: boolean;
    onClose: () => void;
    onTransfer: (data: any) => Promise<void>;
    products: any[];
    warehouses: any[];
    initialData?: any; // Added
}

export const TransferModal: React.FC<TransferModalProps> = ({
    isOpen,
    onClose,
    onTransfer,
    products,
    warehouses,
    initialData
}) => {
    if (!isOpen) return null;

    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [selectedProduct, setSelectedProduct] = useState('');
    const [inputValue, setInputValue] = useState(''); // Track typing input
    const [sourceWarehouse, setSourceWarehouse] = useState('');
    const [destWarehouse, setDestWarehouse] = useState('');
    const [quantity, setQuantity] = useState<number | ''>('');
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    // Stock State
    const [sourceStock, setSourceStock] = useState<number>(0);
    const [destStock, setDestStock] = useState<number>(0);

    // Initialize from initialData if editing
    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setDate(initialData.date);
                setSelectedProduct(initialData.product_id);
                const p = products.find(prod => prod.id === initialData.product_id);
                setInputValue(p ? p.description : '');

                // Canonical ID Resolution for Source
                let sId = initialData.source_warehouse_id;
                const sName = initialData.source_warehouse_name || warehouses.find(w => w.id === sId)?.name;
                if (sName) {
                    const canonicalS = warehouses.find(w => w.name === sName);
                    if (canonicalS) sId = canonicalS.id;
                }
                setSourceWarehouse(sId);

                // Canonical ID Resolution for Dest
                let dId = initialData.dest_warehouse_id;
                const dName = initialData.dest_warehouse_name || warehouses.find(w => w.id === dId)?.name;
                if (dName) {
                    const canonicalD = warehouses.find(w => w.name === dName);
                    if (canonicalD) dId = canonicalD.id;
                }
                setDestWarehouse(dId);

                setQuantity(Math.abs(Number(initialData.quantity)));
            } else {
                setDate(new Date().toISOString().split('T')[0]);
                setSelectedProduct('');
                setInputValue('');
                setSourceWarehouse('');
                setDestWarehouse('');
                setQuantity('');
            }
        }
    }, [isOpen, initialData, warehouses, products]);

    // Fetch Stock when Product or Warehouse changes
    useEffect(() => {
        const fetchStock = async () => {
            if (!selectedProduct) return;

            // Source Stock
            if (sourceWarehouse) {
                try {
                    const snap = await getDoc(doc(db, 'rm_products', selectedProduct, 'warehouse_stock', sourceWarehouse));
                    setSourceStock(snap.exists() ? (snap.data().current_stock || 0) : 0);
                } catch (e) { console.error(e); setSourceStock(0); }
            } else {
                setSourceStock(0);
            }

            // Dest Stock
            if (destWarehouse) {
                try {
                    const snap = await getDoc(doc(db, 'rm_products', selectedProduct, 'warehouse_stock', destWarehouse));
                    setDestStock(snap.exists() ? (snap.data().current_stock || 0) : 0);
                } catch (e) { console.error(e); setDestStock(0); }
            } else {
                setDestStock(0);
            }
        };
        fetchStock();
    }, [selectedProduct, sourceWarehouse, destWarehouse]);

    const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const selected = e.target.value;
        setSourceWarehouse(selected);

        // Auto-select destination if we have exactly 2 warehouses (or just simple logic)
        // User requested: Select W1 -> Auto Select W2. Select W2 -> Auto Select W1.
        if (selected) {
            const other = warehouses.find(w => w.id !== selected);
            if (other) {
                setDestWarehouse(other.id);
            }
        } else {
            setDestWarehouse('');
        }
    };

    const helperGetSupplier = (prod: any) => {
        // Try to get a supplier name to populate the column. 
        // If product has a default supplier, use it. Otherwise 'Transfer'.
        return prod?.supplier_name || 'Stock Transfer';
    };

    const handleSubmit = async () => {
        setError(null);
        if (!date || !selectedProduct || !sourceWarehouse || !destWarehouse || quantity === '') {
            setError("All fields are compulsory.");
            return;
        }

        if (sourceWarehouse === destWarehouse) {
            setError("Source and Destination warehouses cannot be the same.");
            return;
        }

        const qtyNum = Number(quantity);
        if (qtyNum <= 0) {
            setError("Quantity must be greater than 0.");
            return;
        }

        if (qtyNum > sourceStock) {
            setError(`Insufficient stock in Source Warehouse (Available: ${sourceStock})`);
            return;
        }

        setIsProcessing(true);
        try {
            const product = products.find(p => p.id === selectedProduct);

            // Calculate KGs if applicable (for visual consistency in grid, though transfer technically just moves qty)
            let calculated_kgs = 0;
            if (product && product.length && product.width && product.gsm) {
                calculated_kgs = Number(((Number(product.length) * 25.4 / 1000) * (Number(product.width) * 25.4 / 1000) * (Number(product.gsm) / 1000) * qtyNum).toFixed(2));
            }

            // Construct Warehouse Name String (W1 -> W2)
            const sourceName = warehouses.find(w => w.id === sourceWarehouse)?.name || sourceWarehouse;
            const destName = warehouses.find(w => w.id === destWarehouse)?.name || destWarehouse;
            const transferDesc = `${sourceName} -> ${destName}`;

            await onTransfer({
                id: initialData?.id,
                date,
                product_id: selectedProduct,
                product_name: product?.description || '', // Denormalize
                category_name: product?.category_name || '', // ADDED
                supplier_name: helperGetSupplier(product), // ADDED
                quantity: qtyNum,
                source_warehouse_id: sourceWarehouse,
                dest_warehouse_id: destWarehouse,
                warehouse_name: transferDesc, // Save this in the 'warehouse_name' column
                transaction_type: 'Transfer',
                type: 'Transfer',
                uom: product?.uom || '',
                length: product?.length || 0,
                width: product?.width || 0,
                gsm: product?.gsm || 0,
                rate: product?.rate || 0,
                calculated_kgs,
                total_amount: 0
            });
            onClose();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
                <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center">
                    <h3 className="text-xl font-bold text-gray-800">Transfer Stock</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
                </div>

                <div className="p-6 space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date</label>
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Product</label>
                        <input
                            list="transfer-products-list"
                            value={inputValue}
                            onChange={(e) => {
                                const val = e.target.value;
                                setInputValue(val); // Always update text

                                // Try to find product by description to get ID
                                const product = products.find(p => p.description === val);
                                if (product) {
                                    setSelectedProduct(product.id);
                                } else {
                                    setSelectedProduct(''); // Clear ID if text doesn't match an exact product
                                }
                            }}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Type to search product..."
                        />
                        <datalist id="transfer-products-list">
                            {products.map(p => (
                                <option key={p.id} value={p.description} />
                            ))}
                        </datalist>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">From Warehouse</label>
                            <select
                                value={sourceWarehouse}
                                onChange={handleSourceChange}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                <option value="">Select Source</option>
                                {warehouses.map(w => (
                                    <option key={w.id} value={w.id}>{w.name}</option>
                                ))}
                            </select>
                            {sourceWarehouse && selectedProduct && (
                                <div className="text-xs text-blue-600 mt-1 font-bold">Available: {sourceStock}</div>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">To Warehouse</label>
                            <select
                                value={destWarehouse}
                                onChange={(e) => setDestWarehouse(e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                <option value="">Select Destination</option>
                                {warehouses
                                    .filter(w => w.id !== sourceWarehouse) // FILTER OUT SELECTED SOURCE
                                    .map(w => (
                                        <option key={w.id} value={w.id}>{w.name}</option>
                                    ))}
                            </select>
                            {destWarehouse && selectedProduct && (
                                <div className="text-xs text-gray-500 mt-1">Current: {destStock}</div>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Quantity</label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(Number(e.target.value))}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="0.00"
                        />
                    </div>
                </div>

                <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-gray-600 font-medium hover:bg-gray-200 transition-colors"
                        disabled={isProcessing}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className="px-6 py-2 rounded-lg bg-yellow-500 text-white font-bold hover:bg-yellow-600 transition-shadow shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isProcessing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                        Transfer
                    </button>
                </div>
            </div>
        </div>
    );
};
