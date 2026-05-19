import React, { useState, useEffect } from 'react'
import { generatePOPdf, generateDeliveryNote } from '../utils/pdfGenerator'

import { db } from '../firebase'
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore'

interface POPreviewModalProps {
    po: any
    companySettings: any
    section: string
    user: any
    onClose: () => void
}

export const POPreviewModal: React.FC<POPreviewModalProps> = ({ po, companySettings, section, user, onClose }) => {
    const [pdfUri, setPdfUri] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // Helper to Fetch Supplier Info for PDFs (consistent with PurchaseOrders.tsx)
    const fetchSupplierForPdf = async (basePo: any) => {
        let poForPdf = { ...basePo };

        // Fetch Supplier Details
        if (poForPdf.supplier_name) {
            const collectionName = section === 'finished_goods' ? 'fg_buyers' : 'rm_suppliers';
            const suppQuery = query(collection(db, collectionName), where('name', '==', poForPdf.supplier_name));
            const suppSnap = await getDocs(suppQuery);
            if (!suppSnap.empty) {
                const suppData = suppSnap.docs[0].data();
                poForPdf.supplier_address = suppData.address || '';
                poForPdf.supplier_phone = suppData.telephone || '';
            }
        }

        // Fetch missing item_code for older transactions
        if (poForPdf.items && poForPdf.items.length > 0) {
            const prodCollName = section === 'finished_goods' ? 'fg_products' : 'rm_products';
            const updatedItems = [];
            for (let item of poForPdf.items) {
                let currentItem = { ...item };
                if (!currentItem.item_code && currentItem.product_id) {
                    try {
                        const prodRef = doc(db, prodCollName, currentItem.product_id);
                        const prodSnap = await getDoc(prodRef);
                        if (prodSnap.exists()) {
                            currentItem.item_code = prodSnap.data().item_code || '';
                        }
                    } catch (e) {
                        console.error("Failed to fetch item code", e);
                    }
                }
                updatedItems.push(currentItem);
            }
            poForPdf.items = updatedItems;
        }

        return poForPdf;
    }

    useEffect(() => {
        let currentUrl: string | null = null;

        const generatePreview = async () => {
            setIsLoading(true)
            try {
                // Fetch full info first
                const fullInfoPo = await fetchSupplierForPdf(po);

                let output: any;
                if (section === 'finished_goods') {
                    output = await generateDeliveryNote(fullInfoPo, companySettings, 'blob' as any, user);
                } else {
                    output = await generatePOPdf(fullInfoPo, companySettings, 'blob' as any, 'PURCHASE ORDER');
                }
                
                // Create a blob URL which is usually allowed by frame-src blob:
                currentUrl = URL.createObjectURL(output);
                setPdfUri(currentUrl);
            } catch (e) {
                console.error("Failed to generate preview", e)
            } finally {
                setIsLoading(false)
            }
        }
        generatePreview();

        // Cleanup blob URL on unmount or dependency change
        return () => {
            if (currentUrl) {
                URL.revokeObjectURL(currentUrl);
            }
        }
    }, [po, companySettings, section, user])

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[500] backdrop-blur-sm p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="p-4 border-b flex justify-between items-center bg-gray-50 flex-shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">
                            {section === 'finished_goods' ? 'Delivery Note Preview' : 'Purchase Order Preview'}
                        </h2>
                        <p className="text-sm text-gray-500 font-medium">Order: {po.order_no || po.id}</p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500 hover:text-gray-700 font-bold text-2xl"
                    >
                        &times;
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 bg-gray-200 relative overflow-hidden">
                    {isLoading ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white bg-opacity-80">
                            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                            <span className="text-gray-600 font-bold text-lg">Generating Document Preview...</span>
                        </div>
                    ) : pdfUri ? (
                        <iframe 
                            src={pdfUri} 
                            className="w-full h-full border-none shadow-inner"
                            title="PO Preview"
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-red-500 font-bold">
                            Failed to load preview.
                        </div>
                    )}
                </div>

                {/* Action Footer */}
                <div className="p-4 border-t bg-white flex justify-end gap-3 flex-shrink-0">
                    <button 
                        onClick={onClose}
                        className="px-6 py-2 border border-gray-300 rounded-xl font-bold text-gray-600 hover:bg-gray-50 transition"
                    >
                        Close
                    </button>
                    <button 
                        onClick={() => {
                            if (section === 'finished_goods') {
                                generateDeliveryNote(po, companySettings, 'save', user);
                            } else {
                                generatePOPdf(po, companySettings, 'save', 'PURCHASE ORDER');
                            }
                        }}
                        className="px-6 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition shadow-md flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download PDF
                    </button>
                </div>
            </div>
        </div>
    )
}
