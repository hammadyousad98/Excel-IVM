import React, { useState, useEffect, useMemo } from 'react'
import { collection, onSnapshot, query, orderBy, where, deleteDoc, doc, getDocs, writeBatch } from 'firebase/firestore'
import { db } from '../../firebase'
import ExcelLogo from '../../assets/ExcelLogo.png'
import { generateJobCardPdf } from '../../utils/pdfGenerator'
import { useAuth } from '../../context/AuthContext'
import { ConfirmationModal } from '../ConfirmationModal'

interface JobCard {
    id: string
    jobCardNo: string
    jobCardDate: string
    customerData?: any
    [key: string]: any
}

export const JobCardViewer: React.FC = () => {
    const [jobCards, setJobCards] = useState<JobCard[]>([])
    const [searchTerm, setSearchTerm] = useState(() => localStorage.getItem('job_card_search') || '')
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
    const [linkedPOs, setLinkedPOs] = useState<any[]>([])
    const { user } = useAuth()
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    // UI state for sidebar
    const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({})
    const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({})

    useEffect(() => {
        let isSubscribed = true;
        const q = query(collection(db, 'job_cards'), orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!isSubscribed) return;
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as JobCard[];
            setJobCards(data);
        });

        return () => {
            isSubscribed = false;
            unsubscribe();
        };
    }, []);

    // Fetch linked POs for selected Job Card
    useEffect(() => {
        if (!selectedJobId) {
            setLinkedPOs([]);
            return;
        }

        const q = query(
            collection(db, 'rm_purchase_orders'),
            where('job_card_id', '==', selectedJobId)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const pos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLinkedPOs(pos);
        });

        return () => unsubscribe();
    }, [selectedJobId]);

    // Grouping Logic
    const groupedData = useMemo(() => {
        const groups: Record<string, Record<string, JobCard[]>> = {};

        jobCards.forEach(job => {
            if (!job.jobCardDate) return;
            // Parse YYYY-MM-DD
            const [year, monthNum] = job.jobCardDate.split('-');
            if (!year || !monthNum) return;

            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            const month = monthNames[parseInt(monthNum, 10) - 1] || monthNum;

            if (!groups[year]) groups[year] = {};
            if (!groups[year][month]) groups[year][month] = [];
            groups[year][month].push(job);
        });

        return groups;
    }, [jobCards]);

    // Apply Search
    const displayedJobs = useMemo(() => {
        if (!searchTerm.trim()) return null;
        return jobCards.filter(j => j.jobCardNo?.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [jobCards, searchTerm]);

    const selectedJob = useMemo(() => {
        return jobCards.find(j => j.id === selectedJobId) || null;
    }, [jobCards, selectedJobId]);

    const toggleYear = (year: string) => setExpandedYears(prev => ({ ...prev, [year]: !prev[year] }))
    const toggleMonth = (yearMonth: string) => setExpandedMonths(prev => ({ ...prev, [yearMonth]: !prev[yearMonth] }))

    const handleDeleteJobCard = async () => {
        if (!selectedJobId) return
        setIsDeleting(true)
        try {
            const batch = writeBatch(db);

            // 1. Delete Sales Orders linked to this Job Card
            const soQuery = query(collection(db, 'fg_sales_orders'), where('job_card_id', '==', selectedJobId));
            const soSnap = await getDocs(soQuery);
            const soIds: string[] = [];
            soSnap.docs.forEach(d => {
                batch.delete(d.ref);
                soIds.push(d.id);
            });

            // 2. Delete RM Purchase Orders linked to this Job Card
            const rmPoQuery = query(collection(db, 'rm_purchase_orders'), where('job_card_id', '==', selectedJobId));
            const rmPoSnap = await getDocs(rmPoQuery);
            rmPoSnap.docs.forEach(d => batch.delete(d.ref));

            // 3. Delete FG Inventory Transactions linked to this Job Card (Sales Orders, etc.)
            const fgTransQuery = query(collection(db, 'fg_inventory_transactions'), where('job_card_id', '==', selectedJobId));
            const fgTransSnap = await getDocs(fgTransQuery);
            fgTransSnap.docs.forEach(d => batch.delete(d.ref));

            // 4. Delete RM Inventory Transactions linked to this Job Card
            const rmTransQuery = query(collection(db, 'rm_inventory_transactions'), where('job_card_id', '==', selectedJobId));
            const rmTransSnap = await getDocs(rmTransQuery);
            rmTransSnap.docs.forEach(d => batch.delete(d.ref));

            // 5. Delete FG Delivery Notes linked to the Sales Orders found above
            if (soIds.length > 0) {
                for (const soId of soIds) {
                    const dnQuery = query(collection(db, 'fg_delivery_notes'), where('linked_po_id', '==', soId));
                    const dnSnap = await getDocs(dnQuery);
                    dnSnap.docs.forEach(d => batch.delete(d.ref));
                }
            }

            // 6. Finally delete the Job Card itself
            batch.delete(doc(db, 'job_cards', selectedJobId));

            await batch.commit();
            setSelectedJobId(null)
            setIsDeleteModalOpen(false)
        } catch (error) {
            console.error("Error deleting job card and linked entries:", error)
            alert("Failed to delete job card and linked entries. Please check permissions.")
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <div className="flex h-[calc(100vh-100px)] bg-gray-100 overflow-hidden text-gray-800 relative">
            {/* Sidebar */}
            <div className="w-72 bg-white border-r flex flex-col shadow-sm z-10">
                <div className="p-4 border-b bg-gray-50 flex flex-col gap-3">
                    <h2 className="font-bold text-gray-700">Select Job Card</h2>
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search Job Card No..."
                            value={searchTerm}
                            onChange={e => {
                                const val = e.target.value;
                                setSearchTerm(val);
                                localStorage.setItem('job_card_search', val);
                            }}
                            className="border rounded pl-3 pr-8 py-2 text-sm w-full focus:ring-2 focus:ring-blue-400 focus:outline-none"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => {
                                    setSearchTerm('');
                                    localStorage.setItem('job_card_search', '');
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        )}
                    </div>
                </div>

                <div className="p-4 flex-1 overflow-y-auto">
                    {displayedJobs ? (
                        // Search Results
                        <div className="space-y-2">
                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Search Results</h3>
                            {displayedJobs.length === 0 && <p className="text-sm text-gray-400">No matches found.</p>}
                            {displayedJobs.map(job => (
                                <button
                                    key={job.id}
                                    onClick={() => setSelectedJobId(job.id)}
                                    className={`w-full text-left px-3 py-2 rounded text-sm transition ${selectedJobId === job.id ? 'bg-blue-100 text-blue-700 font-bold' : 'hover:bg-gray-100'}`}
                                >
                                    {job.jobCardNo || 'Unknown ID'} - {job.customerData?.customerName}
                                </button>
                            ))}
                        </div>
                    ) : (
                        // Tree View
                        <div className="space-y-1">
                            {Object.keys(groupedData).sort((a, b) => b.localeCompare(a)).map(year => (
                                <div key={year} className="mb-2">
                                    <button
                                        onClick={() => toggleYear(year)}
                                        className="flex items-center gap-2 w-full text-left font-bold text-gray-700 hover:bg-gray-100 px-2 py-1 rounded transition"
                                    >
                                        <svg className={`w-4 h-4 transform transition ${expandedYears[year] ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                        {year}
                                    </button>

                                    {expandedYears[year] && (
                                        <div className="ml-4 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                            {Object.keys(groupedData[year]).sort((a, b) => b.localeCompare(a)).map(month => {
                                                const yearMonthKey = `${year}-${month}`;
                                                return (
                                                    <div key={month} className="mb-1">
                                                        <button
                                                            onClick={() => toggleMonth(yearMonthKey)}
                                                            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-gray-600 hover:bg-gray-100 px-2 py-1 rounded transition"
                                                        >
                                                            <svg className={`w-3 h-3 transform transition ${expandedMonths[yearMonthKey] ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                                            {month}
                                                        </button>

                                                        {expandedMonths[yearMonthKey] && (
                                                            <div className="ml-4 mt-1 space-y-1">
                                                                {groupedData[year][month].map(job => (
                                                                    <button
                                                                        key={job.id}
                                                                        onClick={() => setSelectedJobId(job.id)}
                                                                        className={`w-full text-left px-2 py-1.5 rounded text-xs transition truncate ${selectedJobId === job.id ? 'bg-blue-100 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-100'}`}
                                                                        title={job.jobCardNo}
                                                                    >
                                                                        • {job.jobCardNo || 'No ID'}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-gray-50 overflow-y-auto print:bg-white">
                {selectedJob ? (
                    <div className="p-8 max-w-5xl mx-auto w-full print:p-0">
                        {/* Toolbar */}
                        <div className="mb-6 flex justify-between items-center border-b pb-4 print:hidden">
                            <div>
                                <h1 className="text-2xl font-bold text-gray-800">Job Card: {selectedJob.jobCardNo}</h1>
                                <p className="text-sm text-gray-500">Status: <span className="capitalize font-semibold text-blue-600">{selectedJob.status?.replace('_', ' ')}</span></p>
                            </div>
                            <div className="flex gap-2">
                                {user?.role === 'admin' && (
                                    <button
                                        onClick={() => setIsDeleteModalOpen(true)}
                                        disabled={isDeleting}
                                        className="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 px-4 py-2 rounded shadow flex items-center gap-2 font-bold transition disabled:opacity-50"
                                        title="Delete Job Card"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        Delete
                                    </button>
                                )}
                                <button
                                    onClick={() => generateJobCardPdf(selectedJob, { name: 'EXCEL', logo_path: ExcelLogo }, 'print', linkedPOs)}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow flex items-center gap-2 font-bold transition"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                    Print / Download Report
                                </button>
                            </div>
                        </div>

                        {/* Report Container */}
                        <div className="bg-white shadow-lg border p-12 min-h-[11in] print:shadow-none print:border-none print:p-0">
                            {/* Logo & Header */}
                            <div className="flex justify-center mb-6">
                                <img src={ExcelLogo} alt="Excel Logo" className="h-16" />
                            </div>
                            <h2 className="text-center font-bold text-xl border-y-2 border-black py-1 mb-6">JOB TRACK REPORT</h2>

                            {/* Info Table */}
                            <table className="w-full border-collapse border border-black text-sm mb-6">
                                <tbody>
                                    <tr>
                                        <td className="border border-black p-2 font-bold w-1/6">Job Card Date</td>
                                        <td className="border border-black p-2 w-1/6">{selectedJob.jobCardDate}</td>
                                        <td className="border border-black p-2 font-bold w-1/6">Job Card No.</td>
                                        <td className="border border-black p-2 w-1/6">{selectedJob.jobCardNo}</td>
                                        <td className="border border-black p-2 font-bold w-1/6">Target Date</td>
                                        <td className="border border-black p-2 w-1/6">{selectedJob.targetDate || '-'}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black p-2 font-bold bg-gray-50 text-center uppercase tracking-wider" colSpan={6}>Customer Data</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black p-2 font-bold w-1/6">Customer Name</td>
                                        <td className="border border-black p-2 w-2/6" colSpan={2}>{selectedJob.customerData?.customerName || '-'}</td>
                                        <td className="border border-black p-2 font-bold w-1/6">Job Name</td>
                                        <td className="border border-black p-2 w-2/6" colSpan={2}>{selectedJob.customerData?.jobName || '-'}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black p-2 font-bold w-1/6">PO Date</td>
                                        <td className="border border-black p-2 w-1/6">{selectedJob.customerData?.poDate || '-'}</td>
                                        <td className="border border-black p-2 font-bold w-1/6">PO Quantity</td>
                                        <td className="border border-black p-2 w-1/6">{selectedJob.customerData?.poQuantity || '-'}</td>
                                        <td className="border border-black p-2 font-bold w-1/6">P.O. No.</td>
                                        <td className="border border-black p-2 w-1/6">{selectedJob.customerData?.poNo || '-'}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-black p-2 font-bold w-1/6">Tolerance (Qty)</td>
                                        <td className="border border-black p-2 w-5/6" colSpan={5}>{selectedJob.customerData?.tolerance || '-'}</td>
                                    </tr>
                                    {selectedJob.customerData?.variants && selectedJob.customerData.variants.length > 0 ? (
                                        selectedJob.customerData.variants.map((v: any, idx: number) => (
                                            <tr key={idx}>
                                                <td className="border border-black p-2 font-bold w-1/6">Variant {selectedJob.customerData.variants.length > 1 ? idx + 1 : ''}</td>
                                                <td className="border border-black p-2 w-2/6" colSpan={2}>{v.name || '-'}</td>
                                                <td className="border border-black p-2 font-bold w-1/6">Quantity</td>
                                                <td className="border border-black p-2 w-2/6" colSpan={2}>{v.quantity || v.qty || '-'}</td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td className="border border-black p-2 font-bold w-1/6">Variant</td>
                                            <td className="border border-black p-2 w-2/6" colSpan={2}>{selectedJob.customerData?.variant || '-'}</td>
                                            <td className="border border-black p-2 font-bold w-1/6">Quantity</td>
                                            <td className="border border-black p-2 w-2/6" colSpan={2}>{selectedJob.customerData?.quantity || '-'}</td>
                                        </tr>
                                    )}
                                    {selectedJob.customerData?.comments && (
                                        <tr>
                                            <td className="border border-black p-2 font-bold">Marketing Comments</td>
                                            <td className="border border-black p-2 italic text-gray-600" colSpan={5}>{selectedJob.customerData.comments}</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>

                            {/* Requirements / Specifications */}
                            <div className="mb-6">
                                <h3 className="font-bold border border-black bg-gray-100 p-1 text-center text-sm uppercase">Requirements</h3>
                                <table className="w-full border-collapse border border-black text-xs">
                                    {selectedJob.requirements?.categoryName === 'Catalogue' ? (
                                        <>
                                            <thead>
                                                <tr>
                                                    <th className="border border-black p-1 text-center bg-gray-50 font-bold" colSpan={4}>REQUIREMENTS (For Catalogue)</th>
                                                </tr>
                                                <tr>
                                                    <th className="border border-black p-1 text-center bg-gray-50 font-semibold" colSpan={2}>Title Page</th>
                                                    <th className="border border-black p-1 text-center bg-gray-50 font-semibold" colSpan={2}>Inner Pages</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {[
                                                    { label: 'GSM', key: 'gsm' },
                                                    { label: 'Material Type', key: 'materialType' },
                                                    { label: 'No. of Colours', key: 'noOfColours' },
                                                    { label: 'Lamination', key: 'lamination' },
                                                    { label: 'Coating', key: 'coating' },
                                                    { label: 'Texture', key: 'texture' },
                                                    { label: 'UV / Drip off', key: 'uvDripOff' },
                                                    { label: 'Embossing', key: 'embossing' },
                                                    { label: 'Foiling', key: 'foiling' },
                                                    { label: 'Binding', key: 'binding' }
                                                ].map(row => (
                                                    <tr key={row.label}>
                                                        <td className="border border-black p-1 font-bold w-1/4 bg-gray-50">{row.label}</td>
                                                        <td className="border border-black p-1 w-1/4">{selectedJob.requirements?.titlePage?.[row.key] || '-'}</td>
                                                        <td className="border border-black p-1 font-bold w-1/4 bg-gray-50 border-l-2">{row.label}</td>
                                                        <td className="border border-black p-1 w-1/4">{selectedJob.requirements?.innerPages?.[row.key] || '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </>
                                    ) : (
                                        <>
                                            <thead>
                                                <tr>
                                                    <th className="border border-black p-1 text-center bg-gray-50 font-bold" colSpan={2}>Title Page (For {selectedJob.requirements?.categoryName || 'Product'})</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {[
                                                    { label: 'GSM', key: 'gsm' },
                                                    { label: 'Material Type', key: 'materialType' },
                                                    { label: 'No. of Colours', key: 'noOfColours' },
                                                    { label: 'Lamination', key: 'lamination' },
                                                    { label: 'Coating', key: 'coating' },
                                                    { label: 'Texture', key: 'texture' },
                                                    { label: 'UV / Drip off', key: 'uvDripOff' },
                                                    { label: 'Embossing', key: 'embossing' },
                                                    { label: 'Foiling', key: 'foiling' },
                                                    { label: 'Binding', key: 'binding' }
                                                ].map(row => (
                                                    <tr key={row.label}>
                                                        <td className="border border-black p-1 font-bold w-1/2 bg-gray-50">{row.label}</td>
                                                        <td className="border border-black p-1 w-1/2">{selectedJob.requirements?.titlePage?.[row.key] || '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </>
                                    )}
                                </table>
                            </div>

                            {/* Other Specifications */}
                            {selectedJob.otherSpecs && (
                                <div className="mb-6 border border-black p-2">
                                    <h3 className="font-bold text-sm mb-1 text-center uppercase tracking-wide bg-gray-50 border-b border-black -mx-2 -mt-2 p-1">Other Specifications</h3>
                                    <p className="text-sm mt-2">{selectedJob.otherSpecs}</p>
                                </div>
                            )}

                            {/* Pre Press & Procurement - Stacked Vertically */}
                            <div className="flex flex-col gap-6 mb-6">
                                <div>
                                    <h3 className="font-bold border border-black bg-gray-100 p-1 text-center text-sm uppercase tracking-wide">Pre Press</h3>
                                    <table className="w-full border-collapse border border-black text-xs">
                                        <tbody>
                                            <tr className="grid grid-cols-2">
                                                {Object.entries({
                                                    'Plates': 'plates', 'Pos. UV': 'positiveUV', 'Pos. Die': 'positiveDie',
                                                    'Pos. Foil': 'positiveFoil', 'Emboss. Pos.': 'embossingBlackPositive',
                                                    'Shade Card': 'shadeCard', 'Ups': 'ups', 'Sheet Size': 'sheetSize',
                                                    'Finished Size': 'finishedSize', 'Pages': 'numberOfPages', 'Digital Dummy': 'digitalDummy'
                                                }).map(([label, key]) => (
                                                    <div key={key} className="flex border-b border-r border-black last:border-r-0">
                                                        <td className="p-1 font-bold w-1/2 border-r border-black bg-gray-50">{label}</td>
                                                        <td className="p-1 w-1/2">{selectedJob.phase2Data?.[key] || '-'}</td>
                                                    </div>
                                                ))}
                                                <div className="flex border-b border-black">
                                                    <td className="p-1 font-bold w-1/2 border-r border-black bg-gray-50 invisible">Spacer</td>
                                                    <td className="p-1 w-1/2 invisible">-</td>
                                                </div>
                                            </tr>
                                            {selectedJob.phase2Data?.comments && (
                                                <tr>
                                                    <td className="border border-black p-1 font-bold w-1/4">Comments</td>
                                                    <td className="border border-black p-1 italic text-gray-500" colSpan={3}>{selectedJob.phase2Data.comments}</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <div>
                                    <h3 className="font-bold border border-black bg-gray-100 p-1 text-center text-sm uppercase tracking-wide">Procurement</h3>
                                    <table className="w-full border-collapse border border-black text-xs">
                                        <thead>
                                            <tr className="bg-gray-50 font-bold">
                                                <th className="border border-black p-1">PO Number</th>
                                                <th className="border border-black p-1">Material Type</th>
                                                <th className="border border-black p-1">Material Size</th>
                                                <th className="border border-black p-1">GSM</th>
                                                <th className="border border-black p-1">No. of Sheets</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {linkedPOs.length > 0 ? (
                                                linkedPOs.flatMap(po =>
                                                    (po.items || [])
                                                        .filter((item: any) => item.category?.toUpperCase() === 'PAPER & BOARD')
                                                        .map((item: any, idx: number) => (
                                                            <tr key={`${po.id}-${idx}`}>
                                                                <td className="border border-black p-1 text-center">{po.order_no || po.id}</td>
                                                                <td className="border border-black p-1">{item.product_description || item.product_id}</td>
                                                                <td className="border border-black p-1 text-center">
                                                                    {item.length && item.width ? `${item.length}" x ${item.width}"` : '-'}
                                                                </td>
                                                                <td className="border border-black p-1 text-center">{item.gsm || '-'}</td>
                                                                <td className="border border-black p-1 text-center">{item.quantity || '-'}</td>
                                                            </tr>
                                                        ))
                                                )
                                            ) : (
                                                <tr>
                                                    <td colSpan={5} className="border border-black p-1 text-center text-gray-400 italic">No linked procurement data</td>
                                                </tr>
                                            )}
                                        </tbody>
                                        {selectedJob.phase3Data?.comments && (
                                            <tfoot>
                                                <tr>
                                                    <td className="border border-black p-1 font-bold">Comments</td>
                                                    <td className="border border-black p-1 italic text-gray-500" colSpan={4}>{selectedJob.phase3Data.comments}</td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </div>

                            {/* Phase 4: Store (Inventory Entries) */}
                            <div className="mb-6">
                                <h3 className="font-bold border border-black bg-gray-100 p-1 text-center text-sm uppercase tracking-wide">Store (RM Issue)</h3>
                                <div className="mt-2 text-[10px]">
                                    <table className="w-full border-collapse border border-black text-xs">
                                        <thead className="bg-gray-50 font-bold">
                                            <tr>
                                                <th className="border border-black p-1">Date</th>
                                                <th className="border border-black p-1">Doc/GRN No</th>
                                                <th className="border border-black p-1">Type</th>
                                                <th className="border border-black p-1">Category</th>
                                                <th className="border border-black p-1">Product</th>
                                                <th className="border border-black p-1">Qty</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedJob.phase4Data?.storeLogs?.length > 0 ? (
                                                selectedJob.phase4Data.storeLogs.map((log: any, idx: number) => (
                                                    <tr key={idx}>
                                                        <td className="border border-black p-1 text-center">{log.date || '-'}</td>
                                                        <td className="border border-black p-1 text-center">{log.grn_no || '-'}</td>
                                                        <td className="border border-black p-1 text-center">{log.transaction_type || '-'}</td>
                                                        <td className="border border-black p-1">{log.category_name || '-'}</td>
                                                        <td className="border border-black p-1 font-medium">{log.product_name || '-'}</td>
                                                        <td className="border border-black p-1 text-center font-bold">{log.quantity || '-'}</td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={6} className="border border-black p-2 text-center text-gray-400 italic">No inventory entries recorded</td>
                                                </tr>
                                            )}
                                        </tbody>
                                        {selectedJob.phase4Data?.comments && (
                                            <tfoot>
                                                <tr>
                                                    <td className="border border-black p-1 font-bold">Comments</td>
                                                    <td className="border border-black p-1 italic text-gray-500" colSpan={5}>{selectedJob.phase4Data.comments}</td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </div>

                            {/* Production Logs - Phase 5 */}
                            <div className="mb-6">
                                <h3 className="font-bold border border-black bg-gray-100 p-1 text-center text-sm uppercase tracking-wide">Production Logs</h3>
                                <div className="mt-2">
                                    <table className="w-full border-collapse border border-black text-[10px]">
                                        <thead className="bg-gray-50 font-bold">
                                            <tr>
                                                <th className="border border-black p-1">Start Time</th>
                                                <th className="border border-black p-1">End Time</th>
                                                <th className="border border-black p-1">Machine</th>
                                                <th className="border border-black p-1">Shift</th>
                                                <th className="border border-black p-1">Operator</th>
                                                <th className="border border-black p-1">Assigned Sheets</th>
                                                <th className="border border-black p-1">Prod. Qty</th>
                                                <th className="border border-black p-1">Waste</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedJob.phase5Data?.productionLogs?.length > 0 ? selectedJob.phase5Data.productionLogs.map((log: any, idx: number) => (
                                                <tr key={idx}>
                                                    <td className="border border-black p-1">{log.startTime}</td>
                                                    <td className="border border-black p-1">{log.endTime}</td>
                                                    <td className="border border-black p-1">{log.machine}</td>
                                                    <td className="border border-black p-1">{log.shift}</td>
                                                    <td className="border border-black p-1">{log.operator}</td>
                                                    <td className="border border-black p-1 text-center font-bold">{log.assignedSheets || '-'}</td>
                                                    <td className="border border-black p-1 font-bold text-center">{log.productionQty}</td>
                                                    <td className="border border-black p-1 text-center">{log.waste}</td>
                                                </tr>
                                            )) : (
                                                <tr><td colSpan={8} className="border border-black p-2 text-center text-gray-400 italic">No production logs recorded</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                    {selectedJob.phase5Data?.comments && <p className="text-xs p-1 border-x border-b border-black italic text-gray-500">Comments: {selectedJob.phase5Data.comments}</p>}
                                </div>
                            </div>

                            {/* QC & Delivery - Stacked Vertically */}
                            <div className="flex flex-col gap-6 mb-6">
                                <div>
                                    <h3 className="font-bold border border-black bg-gray-100 p-1 text-center text-sm uppercase tracking-wide">QC Check Logs</h3>
                                    <table className="w-full border-collapse border border-black text-[10px]">
                                        <thead className="bg-gray-50 font-bold">
                                            <tr>
                                                <th className="border border-black p-1">UV</th>
                                                <th className="border border-black p-1">Printing</th>
                                                <th className="border border-black p-1">Die Cut</th>
                                                <th className="border border-black p-1">Lamination</th>
                                                <th className="border border-black p-1">FG</th>
                                                <th className="border border-black p-1">Binding</th>
                                                <th className="border border-black p-1">Packing</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedJob.phase6Data?.qcLogs?.length > 0 ? selectedJob.phase6Data.qcLogs.map((log: any, idx: number) => (
                                                <tr key={idx}>
                                                    <td className="border border-black p-1">{log.uv || '-'}</td>
                                                    <td className="border border-black p-1">{log.printing || '-'}</td>
                                                    <td className="border border-black p-1">{log.dieCutting || '-'}</td>
                                                    <td className="border border-black p-1">{log.lamination || '-'}</td>
                                                    <td className="border border-black p-1 font-bold text-center">{log.fg || '-'}</td>
                                                    <td className="border border-black p-1">{log.binding || '-'}</td>
                                                    <td className="border border-black p-1">{log.packing || '-'}</td>
                                                </tr>
                                            )) : (
                                                <tr><td colSpan={7} className="border border-black p-2 text-center text-gray-400 italic">No QC logs recorded</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                    {selectedJob.phase6Data?.comments && <p className="text-xs p-1 border-x border-b border-black italic text-gray-500">Comments: {selectedJob.phase6Data.comments}</p>}
                                </div>
                                <div>
                                    <h3 className="font-bold border border-black bg-gray-100 p-1 text-center text-sm uppercase tracking-wide">Delivery Status</h3>
                                    <table className="w-full border-collapse border border-black text-[10px]">
                                        <thead className="bg-gray-50 font-bold">
                                            <tr>
                                                <th className="border border-black p-1">FG Received</th>
                                                <th className="border border-black p-1">Delivery Date</th>
                                                <th className="border border-black p-1">Challan No.</th>
                                                <th className="border border-black p-1">Delivered Qty</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedJob.phase7Data?.deliveryLogs?.length > 0 ? selectedJob.phase7Data.deliveryLogs.map((log: any, idx: number) => (
                                                <tr key={idx}>
                                                    <td className="border border-black p-1 text-center font-bold">{log.fgReceived ? 'YES' : 'NO'}</td>
                                                    <td className="border border-black p-1 text-center">{log.deliveryDate || '-'}</td>
                                                    <td className="border border-black p-1 text-center">{log.deliveryChallanNo || '-'}</td>
                                                    <td className="border border-black p-1 text-center font-bold">{log.deliveredQty || '0'}</td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan={4} className="border border-black p-2 text-center text-gray-400 italic">No delivery logs recorded</td>
                                                </tr>
                                            )}
                                        </tbody>
                                        {selectedJob.phase7Data?.comments && (
                                            <tfoot>
                                                <tr>
                                                    <td className="border border-black p-1 font-bold">Comments</td>
                                                    <td className="border border-black p-1 italic text-gray-500" colSpan={3}>{selectedJob.phase7Data.comments}</td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </div>

                            {/* Waste Monitoring - Phase 8 */}
                            <div className="mb-6">
                                <h3 className="font-bold border border-black bg-gray-100 p-1 text-center text-sm uppercase tracking-wide">Waste Monitoring</h3>
                                <table className="w-full border-collapse border border-black text-xs">
                                    <tbody>
                                        <tr>
                                            <td className="border border-black p-1 font-bold w-1/4">Actual Waste %</td>
                                            <td className="border border-black p-1 w-1/4">{selectedJob.phase8Data?.actualWastePercent || '-'}</td>
                                            <td className="border border-black p-1 font-bold w-1/4">Excess Waste %</td>
                                            <td className="border border-black p-1 w-1/4 font-bold text-red-600">{selectedJob.phase8Data?.excessWastePercent || '-'}</td>
                                        </tr>
                                        <tr>
                                            <td className="border border-black p-1 font-bold">Root Cause</td>
                                            <td className="border border-black p-1" colSpan={3}>{selectedJob.phase8Data?.rootCause || '-'}</td>
                                        </tr>
                                        <tr>
                                            <td className="border border-black p-1 font-bold">CAPA</td>
                                            <td className="border border-black p-1" colSpan={3}>{selectedJob.phase8Data?.capa || '-'}</td>
                                        </tr>
                                        {selectedJob.phase8Data?.comments && (
                                            <tr>
                                                <td className="border border-black p-1 font-bold">Closure Comments</td>
                                                <td className="border border-black p-1 italic text-gray-500" colSpan={3}>{selectedJob.phase8Data.comments}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Signatures */}
                            <div className="mb-6">
                                <h3 className="font-bold border border-black bg-gray-100 p-1 text-center text-sm uppercase tracking-wide mb-2">Signatures</h3>
                                <table className="w-full border-collapse border border-black text-[10px] text-center">
                                    <thead className="bg-gray-50 font-bold">
                                        <tr>
                                            <th className="border border-black p-2">Marketing</th>
                                            <th className="border border-black p-2">Pre Press</th>
                                            <th className="border border-black p-2">Procurement</th>
                                            <th className="border border-black p-2">Store</th>
                                            <th className="border border-black p-2">Production</th>
                                            <th className="border border-black p-2">QC</th>
                                            <th className="border border-black p-2">Dispatch</th>
                                            <th className="border border-black p-2">Head</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="h-10">
                                            <td className="border border-black p-1 font-bold text-green-600">{selectedJob.phaseStatuses?.[1] === 'completed' ? '✓ SIGNED' : ''}</td>
                                            <td className="border border-black p-1 font-bold text-green-600">{selectedJob.phaseStatuses?.[2] === 'completed' ? '✓ SIGNED' : ''}</td>
                                            <td className="border border-black p-1 font-bold text-green-600">{selectedJob.phaseStatuses?.[3] === 'completed' ? '✓ SIGNED' : ''}</td>
                                            <td className="border border-black p-1 font-bold text-green-600">{selectedJob.phaseStatuses?.[4] === 'completed' ? '✓ SIGNED' : ''}</td>
                                            <td className="border border-black p-1 font-bold text-green-600">{selectedJob.phaseStatuses?.[5] === 'completed' ? '✓ SIGNED' : ''}</td>
                                            <td className="border border-black p-1 font-bold text-green-600">{selectedJob.phaseStatuses?.[6] === 'completed' ? '✓ SIGNED' : ''}</td>
                                            <td className="border border-black p-1 font-bold text-green-600">{selectedJob.phaseStatuses?.[7] === 'completed' ? '✓ SIGNED' : ''}</td>
                                            <td className="border border-black p-1 font-bold text-green-600">{selectedJob.phaseStatuses?.[8] === 'completed' ? '✓ SIGNED' : ''}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400">
                        <svg className="w-16 h-16 mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <p className="text-lg font-medium">Select a Job Card from the sidebar to view its details</p>
                    </div>
                )}
            </div>
            <ConfirmationModal
                isOpen={isDeleteModalOpen}
                title="Delete Job Card"
                message={`Are you sure you want to delete Job Card ${selectedJob?.jobCardNo}? This action is permanent and cannot be undone.`}
                onConfirm={handleDeleteJobCard}
                onCancel={() => setIsDeleteModalOpen(false)}
                confirmText={isDeleting ? "Deleting..." : "Delete Permanently"}
                isDangerous={true}
            />
        </div>
    )
}
