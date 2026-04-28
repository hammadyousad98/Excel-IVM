import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import { doc, serverTimestamp, setDoc, updateDoc, collection, getDocs, addDoc, query, where, deleteDoc, writeBatch, onSnapshot, orderBy } from 'firebase/firestore'
import { db, storage } from '../../firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { SearchableDropdown } from '../SearchableDropdown'
import { whatsappService } from '../../utils/whatsappService'
import { generateJobCardPdf } from '../../utils/pdfGenerator'
import { ConfirmationModal } from '../ConfirmationModal'

const MATERIAL_TYPES = [
    'Bleach board', 'Box board', 'Art card', 'Art paper', 'Matt paper', 'Rigid box', 'Sticker', 'Offset paper'
]

const PRODUCTION_MACHINES = [
    "Heidelberg 5 Color",
    "Heidelberg Solna 2 Color",
    "Heidelberg CD-74",
    "Bobst-1",
    "Bobst-2",
    "FG-1",
    "KBA 102",
    "Kirma-1",
    "Kirma-2"
]

interface JobCardFormProps {
    onClose: () => void
    initialData?: any
    initialPhase?: number
}

// Map roles to phase numbers
const PHASE_ROLES: Record<number, string[]> = {
    1: ['admin', 'marketing', 'marketing_manager', 'pre_press'],
    2: ['admin', 'pre_press', 'marketing_manager'],
    3: ['admin', 'po_officer'],
    4: ['admin'], // Store phase - handled by inventory but admin can confirm if needed
    5: ['admin', 'production'],
    6: ['admin', 'qc'],
    7: ['admin', 'delivery_officer'],
    8: ['admin', 'head'],
}

interface ProductionLog {
    id: string;
    startTime: string;
    endTime: string;
    machine: string;
    shift: string;
    operator: string;
    productionQty: string;
    waste: string;
}

export const JobCardForm: React.FC<JobCardFormProps> = ({ onClose, initialData, initialPhase }) => {
    const { user } = useAuth()
    const [activeDocId, setActiveDocId] = useState<string | null>(initialData?.id || null)
    const isNew = !activeDocId

    // Core state
    const [jobCardNo, setJobCardNo] = useState(initialData?.jobCardNo || '')
    const [jobCardDate, setJobCardDate] = useState(initialData?.jobCardDate || new Date().toISOString().split('T')[0])
    const [targetDate, setTargetDate] = useState(initialData?.targetDate || '')
    const [status, setStatus] = useState(initialData?.status || 'in_progress')
    const [currentPhase, setCurrentPhase] = useState<number>(initialData?.currentPhase || 1)
    const [salesOrderId, setSalesOrderId] = useState<string | null>(initialData?.salesOrderId || null)

    // Status Tracker
    const [phaseStatuses, setPhaseStatuses] = useState<Record<number, 'pending' | 'completed' | 'needs_reconfirmation'>>(
        initialData?.phaseStatuses || { 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending', 6: 'pending', 7: 'pending', 8: 'pending' }
    )

    // Phase 1 (Marketing)
    const [customerData, setCustomerData] = useState(initialData?.customerData || {
        customerName: '', jobName: '', newOrRepeat: 'New', poDate: '', poQuantity: '', poNo: '', tolerance: '',
        variants: initialData?.customerData?.variants || [], comments: '',
        marketingManagerSignature: false, poFileUrl: '', poFileName: '', sampleFileUrl: '', sampleFileName: ''
    })
    const [requirements, setRequirements] = useState(initialData?.requirements || {
        categoryId: '', categoryName: '',
        titlePage: { gsm: '', materialType: '', printingType: '', noOfColours: '', lamination: '', coating: '', texture: '', uvDripOff: '', embossing: '', foiling: '', binding: '' },
        innerPages: { gsm: '', materialType: '', printingType: '', noOfColours: '', lamination: '', coating: '', texture: '', uvDripOff: '', embossing: '', foiling: '', binding: '' }
    })
    const [otherSpecs, setOtherSpecs] = useState<string>(initialData?.otherSpecs || '')

    // Phase 2 (Pre Press)
    const [phase2Data, setPhase2Data] = useState(initialData?.phase2Data || {
        plates: '', positiveUV: '', positiveDie: '', positiveFoil: '', embossingBlackPositive: '', shadeCard: '', ups: '', 
        sheetSize: '', sheetSizeL: '', sheetSizeW: '', sheetSizeGsm: '', 
        finishedSize: '', numberOfPages: '', digitalDummy: '', comments: '',
        sampleFileUrl: '', sampleFileName: ''
    })

    // Phase 3 (Procurement)
    const [phase3Data, setPhase3Data] = useState(initialData?.phase3Data || {
        materialType: '', materialSize: '', gsm: '', noOfSheets: '', comments: ''
    })

    // Phase 4 (Store) - Linked to Inventory
    const [phase4Data, setPhase4Data] = useState(initialData?.phase4Data?.storeLogs ? initialData.phase4Data : {
        storeLogs: [],
        comments: ''
    })

    // Phase 5 (Production)
    const [phase5Data, setPhase5Data] = useState({
        productionLogs: initialData?.phase5Data?.productionLogs || initialData?.phase4Data?.productionLogs || [],
        comments: initialData?.phase5Data?.comments || initialData?.phase4Data?.comments || '',
        allowedWastage: initialData?.phase5Data?.allowedWastage || ''
    })

    const [newProductionLog, setNewProductionLog] = useState({
        startTime: '', endTime: '', machine: '', shift: '', operator: '', assignedSheets: '', productionQty: '', waste: ''
    })

    // Phase 6 (QC Check)
    const [phase6Data, setPhase6Data] = useState({
        qcLogs: initialData?.phase6Data?.qcLogs || initialData?.phase5Data?.qcLogs || [],
        comments: initialData?.phase6Data?.comments || initialData?.phase5Data?.comments || ''
    })

    const [newQCLog, setNewQCLog] = useState({
        uv: '', printing: '', dieCutting: '', lamination: '', fg: '', binding: '', packing: '',
        fileUrl: '', fileName: ''
    })

    // Phase 7 (Delivery Status)
    const [phase7Data, setPhase7Data] = useState({
        deliveryLogs: initialData?.phase7Data?.deliveryLogs || initialData?.phase6Data?.deliveryLogs || [],
        comments: initialData?.phase7Data?.comments || initialData?.phase6Data?.comments || ''
    })

    const [newDeliveryLog, setNewDeliveryLog] = useState({
        fgReceived: false, deliveryDate: '', deliveryChallanNo: '', deliveredQty: ''
    })

    // Phase 8 (Closure)
    const [phase8Data, setPhase8Data] = useState(initialData?.phase8Data || {
        actualWastePercent: '', excessWastePercent: '', rootCause: '', capa: '', prodSignature: false, qcSignature: false, headSignature: false, comments: ''
    })

    const [categories, setCategories] = useState<any[]>([])
    const [buyers, setBuyers] = useState<any[]>([])
    const [products, setProducts] = useState<any[]>([])

    const [activeTab, setActiveTab] = useState<number>(initialPhase || initialData?.currentPhase || 1)
    const [loading, setLoading] = useState(false)
    const [fieldLoading, setFieldLoading] = useState<Record<string, boolean>>({})
    const [error, setError] = useState('')

    // Confirmation Modal State
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
    const [phaseToConfirm, setPhaseToConfirm] = useState<number | null>(null)
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isNoDataModalOpen, setIsNoDataModalOpen] = useState(false)
    const [noDataJobName, setNoDataJobName] = useState('')
    const [isMarketingApprovalModalOpen, setIsMarketingApprovalModalOpen] = useState(false)

    const addProductionLog = () => {
        if (!phase5Data.allowedWastage) {
            setError("Please add Allowed Wastage first.");
            return;
        }
        const id = Math.random().toString(36).substr(2, 9);
        setPhase5Data({
            ...phase5Data,
            productionLogs: [...(phase5Data.productionLogs || []), { ...newProductionLog, id }]
        });
        setNewProductionLog({ startTime: '', endTime: '', machine: '', shift: '', operator: '', assignedSheets: '', productionQty: '', waste: '' });
    };

    const handleDeleteJobCard = async () => {
        if (!activeDocId) return
        setLoading(true)
        setError('')
        try {
            const batch = writeBatch(db);

            // 1. Delete Sales Orders linked to this Job Card
            const soQuery = query(collection(db, 'fg_sales_orders'), where('job_card_id', '==', activeDocId));
            const soSnap = await getDocs(soQuery);
            const soIds: string[] = [];
            soSnap.docs.forEach(d => {
                batch.delete(d.ref);
                soIds.push(d.id);
            });

            // 2. Delete RM Purchase Orders linked to this Job Card
            const rmPoQuery = query(collection(db, 'rm_purchase_orders'), where('job_card_id', '==', activeDocId));
            const rmPoSnap = await getDocs(rmPoQuery);
            rmPoSnap.docs.forEach(d => batch.delete(d.ref));

            // 3. Delete FG Inventory Transactions linked to this Job Card (by job_card_id, so_id, or po_id)
            const fgTransSpecs = [
                { field: 'job_card_id', value: activeDocId },
                ...soIds.map(id => ({ field: 'so_id', value: id })),
                ...soIds.map(id => ({ field: 'po_id', value: id }))
            ];

            for (const spec of fgTransSpecs) {
                const q = query(collection(db, 'fg_inventory_transactions'), where(spec.field, '==', spec.value));
                const snap = await getDocs(q);
                snap.docs.forEach(d => batch.delete(d.ref));
            }

            // 4. Delete RM Inventory Transactions linked to this Job Card
            const rmTransQuery = query(collection(db, 'rm_inventory_transactions'), where('job_card_id', '==', activeDocId));
            const rmTransSnap = await getDocs(rmTransQuery);
            rmTransSnap.docs.forEach(d => batch.delete(d.ref));

            // 5. Delete FG Delivery Notes linked to the Sales Orders found above
            if (soIds.length > 0) {
                // We can only use 'in' for up to 10 IDs. Usually one JC has one SO.
                // If there are many, we might need multiple queries. 
                // For safety, let's just query all DNs if soIds is small or use a loop.
                for (const soId of soIds) {
                    const dnQuery = query(collection(db, 'fg_delivery_notes'), where('linked_po_id', '==', soId));
                    const dnSnap = await getDocs(dnQuery);
                    dnSnap.docs.forEach(d => batch.delete(d.ref));
                }
            }

            // 6. Finally delete the Job Card itself
            batch.delete(doc(db, 'job_cards', activeDocId));

            await batch.commit();
            onClose();
        } catch (err) {
            console.error("Failed to delete job card and linked entries", err)
            setError("Failed to delete job card. Please check your permissions.")
        } finally {
            setLoading(false)
        }
    }

    const triggerConfirm = (phaseNum: number) => {
        setPhaseToConfirm(phaseNum)
        setIsConfirmModalOpen(true)
    }

    const deleteProductionLog = (id: string) => {
        setPhase5Data({
            ...phase5Data,
            productionLogs: phase5Data.productionLogs.filter((log: any) => log.id !== id)
        });
    };

    const addQCLog = () => {
        const id = Math.random().toString(36).substr(2, 9);
        setPhase6Data({
            ...phase6Data,
            qcLogs: [...(phase6Data.qcLogs || []), { ...newQCLog, id }]
        });
        setNewQCLog({ uv: '', printing: '', dieCutting: '', lamination: '', fg: '', binding: '', packing: '', fileUrl: '', fileName: '' });
    };

    const deleteQCLog = (id: string) => {
        setPhase6Data({
            ...phase6Data,
            qcLogs: phase6Data.qcLogs.filter((log: any) => log.id !== id)
        });
    };

    // Phase 1 Multi-Variant
    const addVariant = () => {
        const id = Math.random().toString(36).substr(2, 9);
        setCustomerData({
            ...customerData,
            variants: [...(customerData.variants || []), { id, name: '', quantity: '' }]
        });
    };

    const updateVariant = (id: string, field: string, value: string) => {
        setCustomerData({
            ...customerData,
            variants: (customerData.variants || []).map((v: any) =>
                v.id === id ? { ...v, [field]: value } : v
            )
        });
    };

    const deleteVariant = (id: string) => {
        setCustomerData({
            ...customerData,
            variants: customerData.variants.filter((v: any) => v.id !== id)
        });
    };

    // Phase 7 Delivery Logs
    const addDeliveryLog = () => {
        const id = Math.random().toString(36).substr(2, 9);
        setPhase7Data({
            ...phase7Data,
            deliveryLogs: [...(phase7Data.deliveryLogs || []), { ...newDeliveryLog, id }]
        });
        setNewDeliveryLog({ fgReceived: false, deliveryDate: '', deliveryChallanNo: '', deliveredQty: '' });
    };

    const deleteDeliveryLog = (id: string) => {
        setPhase7Data({
            ...phase7Data,
            deliveryLogs: phase7Data.deliveryLogs.filter((log: any) => log.id !== id)
        });
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, folder: string, fieldToUpdate: string, stateUpdateFn: any) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // 5MB Limit Check
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        if (file.size > MAX_SIZE) {
            setError("File is too large. Maximum allowed size is 5MB.");
            e.target.value = '';
            return;
        }

        // Validation for file types
        const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
        if (!allowedTypes.includes(file.type)) {
            setError("Invalid file type. Only PDF, PNG, JPG, JPEG are allowed.");
            e.target.value = '';
            return;
        }

        const fileNameField = fieldToUpdate.replace('Url', 'Name');
        setFieldLoading(prev => ({ ...prev, [fieldToUpdate]: true }));
        setError('');

        if (window.electron?.ipcRenderer) {
            window.electron.ipcRenderer.send('log-to-terminal', `Starting Cloudinary upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        }

        try {
            // In Electron, the 'path' property on File objects contains the absolute path on disk.
            // We use this to read and upload the file from the Main process to bypass CSP/SSL issues.
            const filePath = (file as any).path;

            if (!filePath) {
                throw new Error("Could not access file path. Please try dragging the file onto the input.");
            }

            const result = await window.electron.ipcRenderer.invoke('upload-to-cloudinary', {
                filePath,
                folder: `job_cards/${folder}`
            });

            const downloadUrl = result.secure_url;

            stateUpdateFn((prev: any) => ({
                ...prev,
                [fieldToUpdate]: downloadUrl,
                [fileNameField]: file.name
            }));

            if (window.electron?.ipcRenderer) {
                window.electron.ipcRenderer.send('log-to-terminal', `Cloudinary upload successful: ${file.name}`);
            }
        } catch (err: any) {
            console.error("Cloudinary upload failed", err);
            setError(`Upload failed: ${err.message || 'Please check your internet connection and try again.'}`);
            if (window.electron?.ipcRenderer) {
                window.electron.ipcRenderer.send('log-to-terminal', `Cloudinary Error: ${err.message}`);
            }
        } finally {
            setFieldLoading(prev => ({ ...prev, [fieldToUpdate]: false }));
        }
    };

    useEffect(() => {
        const unsubCats = onSnapshot(collection(db, 'fg_categories'), (snap) => {
            setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubBuyers = onSnapshot(collection(db, 'fg_buyers'), (snap) => {
            setBuyers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubProds = onSnapshot(collection(db, 'fg_products'), (snap) => {
            setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => {
            unsubCats();
            unsubBuyers();
            unsubProds();
        };
    }, []);


    const fetchExistingJobCardData = async (jobNameValue: string, isRepeatSelected: boolean) => {
        if (!jobNameValue || !isRepeatSelected) return;

        setLoading(true);
        try {
            const jcRef = collection(db, 'job_cards');
            // Note: This query requires a composite index in Firestore: customerData.jobName ASC, createdAt DESC
            // If the index is missing, it will throw an error with a link to create it.
            const q = query(
                jcRef,
                where('customerData.jobName', '==', jobNameValue),
                orderBy('createdAt', 'desc')
            );
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                setError('');
                const latestJC = querySnapshot.docs[0].data();

                // Auto-fill Phase 1 (Core details)
                setCustomerData((prev: any) => ({
                    ...prev,
                    customerName: latestJC.customerData?.customerName || prev.customerName,
                    variants: latestJC.customerData?.variants || [],
                    jobName: jobNameValue // Ensure we keep the selected job name
                }));

                // Auto-fill Requirements
                setRequirements(latestJC.requirements || requirements);

                // Auto-fill Other Specs
                setOtherSpecs(latestJC.otherSpecs || '');

                // Auto-fill Phase 2
                setPhase2Data((prev: any) => ({
                    ...(latestJC.phase2Data || prev),
                    comments: '' // Don't copy comments from old job
                }));

                if (window.electron && window.electron.ipcRenderer) {
                    window.electron.ipcRenderer.send('log-to-terminal', `Auto-filled data for repeat job: ${jobNameValue}`);
                }
            } else {
                setNoDataJobName(jobNameValue);
                setIsNoDataModalOpen(true);
                if (window.electron && window.electron.ipcRenderer) {
                    window.electron.ipcRenderer.send('log-to-terminal', `No previous job card found for: ${jobNameValue}`);
                }
            }
        } catch (err: any) {
            console.error("Failed to fetch repeat job data", err);
            // If it's an index error, it's better to log it clearly
            if (err.message?.includes('index')) {
                setError("Repeat job search requires a database index. Please check console logs.");
            } else {
                setError("Failed to fetch repeat job data.");
            }
        } finally {
            setLoading(false);
        }
    };

    // Real-time listener for RM Inventory Transactions (Store Phase)
    useEffect(() => {
        if (!activeDocId) return;

        const q = query(
            collection(db, 'rm_inventory_transactions'),
            where('job_card_id', '==', activeDocId)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const logs = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            }));
            setPhase4Data((prev: any) => ({
                ...prev,
                storeLogs: logs
            }));
        });

        return () => unsubscribe();
    }, [activeDocId]);

    // Real-time listener for RM Purchase Orders (Procurement Phase)
    useEffect(() => {
        if (!activeDocId) return;

        const q = query(
            collection(db, 'rm_purchase_orders'),
            where('job_card_id', '==', activeDocId)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot.empty) {
                const poDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                const allItems = poDocs.flatMap((po: any) => po.items || []);
                
                if (allItems.length > 0) {
                    // Extract unique types, sizes, and gsm
                    const types = Array.from(new Set(allItems.map((i: any) => i.product_description || i.category))).filter(Boolean);
                    const sizes = Array.from(new Set(allItems.map((i: any) => (i.length && i.width) ? `${i.length}x${i.width}` : ''))).filter(Boolean);
                    const gsms = Array.from(new Set(allItems.map((i: any) => i.gsm))).filter(val => val !== undefined && val !== null && val !== '');
                    const totalQty = allItems.reduce((sum: number, i: any) => sum + Number(i.quantity || 0), 0);
                    const poNumbers = poDocs.map((po: any) => po.order_no).filter(Boolean);

                    setPhase3Data({
                        materialType: types.join(', '),
                        materialSize: sizes.join(', '),
                        gsm: gsms.join(', '),
                        noOfSheets: totalQty.toString(),
                        comments: `Linked POs: ${poNumbers.join(', ')}`
                    });

                    // Auto-complete Phase 3 status locally
                    setPhaseStatuses(prev => {
                        if (prev[3] !== 'completed') {
                            return { ...prev, 3: 'completed' };
                        }
                        return prev;
                    });
                }
            }
        }, (err) => {
            console.error("Phase 3 Sync Error:", err);
        });

        return () => unsubscribe();
    }, [activeDocId]);

    const isPhaseUnlocked = (phaseNum: number) => {
        // If the job card is completed, all phases should be accessible for viewing
        if (status?.toLowerCase() === 'completed') return true;

        // If this specific phase is already completed, it's always unlocked for viewing/editing (subject to role permissions)
        if (phaseStatuses[phaseNum] === 'completed') return true;

        if (phaseNum === 1) return true;
        if (phaseNum === 2) {
            return phaseStatuses[1] === 'completed' && customerData.marketingManagerSignature === true;
        }
        return phaseStatuses[phaseNum - 1] === 'completed';
    }

    const canEditPhase = (phaseNum: number) => {
        if (!user) return false;

        // Restriction: If job card is completed, only admin and marketing_manager can edit
        if (status?.toLowerCase() === 'completed') {
            return ['admin', 'marketing_manager'].includes(user.role);
        }

        const allowedRoles = PHASE_ROLES[phaseNum] || [];
        const hasRole = allowedRoles.includes(user.role);

        // Special rule: pre_press can edit Phase 1 only on an existing job card
        // that has already progressed past Phase 1 (i.e., Phase 1 confirmed by marketing).
        // They cannot create new cards or edit Phase 1 on a brand-new unsaved card.
        if (user.role === 'pre_press' && phaseNum === 1) {
            return !isNew && currentPhase >= 2;
        }

        return hasRole && isPhaseUnlocked(phaseNum);
    }

    const sendNotification = async (targetPhase: number, message: string, jobNum: string, id: string | null, isReconfirm: boolean = false) => {
        const roles = PHASE_ROLES[targetPhase] || [];

        // 1. Send in-app notifications (Existing logic)
        for (const role of roles) {
            if (role === 'admin') continue;
            await addDoc(collection(db, 'notifications'), {
                role: role,
                title: `Job Card Update: ${jobNum}`,
                message: message,
                read: false,
                createdAt: serverTimestamp(),
                linkToJobCard: jobNum,
                jobCardId: id,
                targetPhase: targetPhase
            });
        }

        // 2. Send WhatsApp notifications
        try {
            if (window.electron && window.electron.ipcRenderer) {
                window.electron.ipcRenderer.send('log-to-terminal', `Sending notifications for phase ${targetPhase}, roles: ${roles.join(', ')}`);
            }

            // Find users with the target roles to get their phone numbers
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('role', 'in', roles));
            const querySnapshot = await getDocs(q);

            const whatsappMsg = whatsappService.formatJobCardMessage(jobNum, targetPhase, isReconfirm);

            for (const userDoc of querySnapshot.docs) {
                const userData = userDoc.data();
                if (userData.whatsappNumber) {
                    if (window.electron && window.electron.ipcRenderer) {
                        window.electron.ipcRenderer.send('log-to-terminal', `Sending WhatsApp to ${userData.whatsappNumber} (User: ${userData.username})`);
                    }
                    await whatsappService.sendMessage(userData.whatsappNumber, whatsappMsg);
                }
            }

        } catch (error) {
            console.error("Failed to send WhatsApp notifications", error);
            if (window.electron && window.electron.ipcRenderer) {
                window.electron.ipcRenderer.send('log-to-terminal', `WhatsApp notification error: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    const handleConfirmPhase = async (phaseNum: number) => {
        setLoading(true)
        setError('')

        // Validation for Phase 8: Root Cause is mandatory if excess wastage exists
        if (phaseNum === 8) {
            const totalActualWastage = (phase5Data.productionLogs || []).reduce((sum: number, log: any) => sum + Number(log.waste || 0), 0);
            const allowedWastage = Number(phase5Data.allowedWastage || 0);
            const excessWastage = Math.max(0, totalActualWastage - allowedWastage);
            
            const calculatedExcessPercent = allowedWastage > 0 ? ((excessWastage / allowedWastage) * 100).toFixed(2) : '0.00';
            const calculatedActualPercent = allowedWastage > 0 ? ((totalActualWastage / allowedWastage) * 100).toFixed(2) : '0.00';

            if (excessWastage > 0 && !phase8Data.rootCause?.trim()) {
                setError("Root Cause is mandatory because actual wastage exceeds allowed wastage.");
                setLoading(false);
                return;
            }

            // Update phase8Data with calculated values before saving
            phase8Data.actualWastePercent = calculatedActualPercent;
            phase8Data.excessWastePercent = calculatedExcessPercent;
            setPhase8Data({ ...phase8Data });
        }

        const isEditingPast = phaseStatuses[phaseNum] === 'completed' || phaseStatuses[phaseNum] === 'needs_reconfirmation';
        const newStatuses = { ...phaseStatuses };
        newStatuses[phaseNum] = 'completed';

        let cascadeHappened = false;

        // Cascading Reset tracking
        if (isEditingPast) {
            // Exclude continuous phases (Procurement, Store, Delivery) from triggering resets
            // Phase 3: Procurement, Phase 4: Store, Phase 7: Delivery
            const isContinuousPhase = [3, 4, 7].includes(phaseNum);

            if (!isContinuousPhase) {
                for (let i = phaseNum + 1; i <= 8; i++) {
                    if (newStatuses[i] === 'completed') {
                        newStatuses[i] = 'needs_reconfirmation';
                        cascadeHappened = true;
                    }
                }
            }
        }

        // Linear Progression tracking
        let newCurrentPhase = currentPhase;
        if (currentPhase === phaseNum && phaseNum < 8) {
            newCurrentPhase = phaseNum + 1;
            setActiveTab(phaseNum + 1);
        }

        setPhaseStatuses(newStatuses);
        if (newCurrentPhase !== currentPhase) {
            setCurrentPhase(newCurrentPhase);
        }

        // If Phase 1 is being confirmed, and we're NOT the marketing manager approving it right now
        // (meaning it's just the regular phase completion), we don't advance the phase if signature is missing
        if (phaseNum === 1 && !customerData.marketingManagerSignature) {
            // Don't auto-advance to phase 2 yet
            if (newCurrentPhase === 2) {
                setCurrentPhase(1);
                setActiveTab(1);
            }
        }

        try {
            const dataToSave: any = {
                jobCardDate, targetDate,
                currentPhase: newCurrentPhase,
                phaseStatuses: newStatuses,
                status: newCurrentPhase === 8 && newStatuses[8] === 'completed' ? 'completed' : 'in_progress',
                customerData, requirements, otherSpecs,
                phase2Data, phase3Data, phase4Data, phase5Data, phase6Data, phase7Data, phase8Data,
                updatedAt: serverTimestamp()
            }

            let savedCardNo = jobCardNo;
            const docRef = !activeDocId ? doc(collection(db, 'job_cards')) : doc(db, 'job_cards', activeDocId);

            if (!activeDocId) {
                savedCardNo = jobCardNo || `JC-${Math.floor(Math.random() * 100000)}`
                if (!jobCardNo) setJobCardNo(savedCardNo)
                await setDoc(docRef, {
                    ...dataToSave,
                    jobCardNo: savedCardNo,
                    id: docRef.id,
                    createdAt: serverTimestamp(),
                    createdBy: user?.uid
                })
                setActiveDocId(docRef.id)
            } else {
                await updateDoc(docRef, dataToSave)
            }

            // --- LINK TO SALES ORDER (PHASE 1) ---
            if (phaseNum === 1) {
                try {
                    const batch = writeBatch(db);

                    if (window.electron && window.electron.ipcRenderer) {
                        window.electron.ipcRenderer.send('log-to-terminal', `Syncing Sales Order for ${customerData.customerName} - ${customerData.jobName}`);
                    }

                    // 1. Resolve IDs with better matching
                    const buyerDoc = buyers.find(b => b.name?.trim().toLowerCase() === customerData.customerName?.trim().toLowerCase());
                    const categoryDoc = categories.find(c => c.name?.trim().toLowerCase() === requirements.categoryName?.trim().toLowerCase());
                    const productDoc = products.find(p => p.description?.trim().toLowerCase() === customerData.jobName?.trim().toLowerCase());

                    if (window.electron && window.electron.ipcRenderer) {
                        if (!buyerDoc) window.electron.ipcRenderer.send('log-to-terminal', `WARN: Buyer not found: ${customerData.customerName}`);
                        if (!categoryDoc) window.electron.ipcRenderer.send('log-to-terminal', `WARN: Category not found: ${requirements.categoryName}`);
                        if (!productDoc) window.electron.ipcRenderer.send('log-to-terminal', `WARN: Product not found: ${customerData.jobName}`);
                    }

                    const soData: any = {
                        date: customerData.poDate || jobCardDate,
                        customer_id: buyerDoc?.id || '',
                        customer_name: customerData.customerName,
                        po_no: customerData.poNo,
                        job_card_id: docRef.id,
                        job_card_no: savedCardNo,
                        items: [{
                            category_id: categoryDoc?.id || '',
                            category_name: requirements.categoryName,
                            product_id: productDoc?.id || '',
                            product_name: customerData.jobName,
                            quantity: Number(customerData.poQuantity || 0),
                            tolerance: Number(customerData.tolerance || 0),
                            item_code: productDoc?.item_code || '',
                            uom: productDoc?.uom || ''
                        }],
                        total_quantity: Number(customerData.poQuantity || 0),
                        updatedAt: serverTimestamp()
                    };

                    let currentSOId = salesOrderId;
                    const soColl = collection(db, 'fg_sales_orders');
                    let soTargetRef;

                    if (!currentSOId) {
                        // Check if an SO already exists for this Job Card ID (to prevent duplicates if state is lost)
                        const existingSOQuery = query(soColl, where('job_card_id', '==', docRef.id));
                        const existingSOSnap = await getDocs(existingSOQuery);
                        
                        if (!existingSOSnap.empty) {
                            currentSOId = existingSOSnap.docs[0].id;
                            setSalesOrderId(currentSOId);
                        }
                    }

                    if (!currentSOId) {
                        soTargetRef = doc(soColl);
                        soData.createdAt = serverTimestamp();
                        soData.createdBy = user?.uid || 'system';
                        batch.set(soTargetRef, soData);
                        currentSOId = soTargetRef.id;
                        setSalesOrderId(currentSOId);
                        // Update the job card with the SO ID separately to ensure it is recorded
                        await updateDoc(docRef, { salesOrderId: currentSOId });
                    } else {
                        soTargetRef = doc(db, 'fg_sales_orders', currentSOId);
                        batch.update(soTargetRef, soData);
                    }

                    // 2. Resolve Inventory Sheet
                    const soDateObj = new Date(soData.date);
                    const month = soDateObj.getMonth() + 1;
                    const year = soDateObj.getFullYear();

                    const sheetsQuery = query(
                        collection(db, 'fg_inventory_sheets'),
                        where('month', '==', month),
                        where('year', '==', year),
                        where('section', '==', 'finished_goods')
                    );
                    const sheetsSnap = await getDocs(sheetsQuery);
                    let sheetId = '';

                    if (sheetsSnap.empty) {
                        const newSheetRef = doc(collection(db, 'fg_inventory_sheets'));
                        batch.set(newSheetRef, {
                            month, year, section: 'finished_goods', createdAt: serverTimestamp()
                        });
                        sheetId = newSheetRef.id;
                    } else {
                        sheetId = sheetsSnap.docs[0].id;
                    }

                    // 3. Update Inventory Transaction
                    const transQuery = query(
                        collection(db, 'fg_inventory_transactions'),
                        where('so_id', '==', currentSOId)
                    );
                    const transSnap = await getDocs(transQuery);
                    transSnap.docs.forEach(d => batch.delete(d.ref));

                    const newTransRef = doc(collection(db, 'fg_inventory_transactions'));
                    batch.set(newTransRef, {
                        sheet_id: sheetId,
                        job_card_id: docRef.id,
                        so_id: currentSOId,
                        date: soData.date,
                        type: 'Sales Order',
                        transaction_type: 'Sales Order',
                        po_no: customerData.poNo,
                        customer_name: customerData.customerName,
                        manual_supplier_name: customerData.customerName,
                        supplier_name: customerData.customerName,
                        category_name: requirements.categoryName,
                        manual_category_name: requirements.categoryName,
                        product_id: productDoc?.id || '',
                        product_name: customerData.jobName,
                        manual_product_name: customerData.jobName,
                        quantity: Number(customerData.poQuantity || 0),
                        display_quantity: Number(customerData.poQuantity || 0),
                        tolerance: Number(customerData.tolerance || 0),
                        uom: productDoc?.uom || '',
                        createdAt: serverTimestamp(),
                        createdBy: user?.uid || 'system'
                    });

                    await batch.commit();
                    if (window.electron && window.electron.ipcRenderer) {
                        window.electron.ipcRenderer.send('log-to-terminal', `Successfully synced Sales Order and Transaction for ${savedCardNo}`);
                    }

                } catch (error) {
                    console.error("Error creating/updating Sales Order:", error);
                    setError("Job Card saved, but failed to sync Sales Order system.");
                    if (window.electron && window.electron.ipcRenderer) {
                        window.electron.ipcRenderer.send('log-to-terminal', `ERR: Sales Order sync failed: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }

            if (window.electron && window.electron.ipcRenderer) {
                window.electron.ipcRenderer.send('log-to-terminal', `Saved Job Card ${savedCardNo}`);
            }

            if (phaseNum === 1 && !customerData.marketingManagerSignature) {
                try {
                    const mmQuery = query(collection(db, 'users'), where('role', '==', 'marketing_manager'));
                    const mmSnapshot = await getDocs(mmQuery);
                    const mmMsg = `Job Card ${savedCardNo} Phase 1 has been completed and requires your approval. Please review and sign off.`;

                    for (const mmDoc of mmSnapshot.docs) {
                        const mmData = mmDoc.data();
                        
                        // In-app notification
                        await addDoc(collection(db, 'notifications'), {
                            role: 'marketing_manager',
                            title: `Approval Required: ${savedCardNo}`,
                            message: mmMsg,
                            read: false,
                            createdAt: serverTimestamp(),
                            linkToJobCard: savedCardNo,
                            jobCardId: docRef.id,
                            targetPhase: 1
                        });

                        // WhatsApp notification
                        if (mmData.whatsappNumber) {
                            await whatsappService.sendMessage(mmData.whatsappNumber, mmMsg);
                        }
                    }
                    if (window.electron && window.electron.ipcRenderer) {
                        window.electron.ipcRenderer.send('log-to-terminal', `Sent notification to Marketing Managers for Phase 1 approval.`);
                    }
                } catch (error) {
                    console.error("Failed to send Phase 1 approval notifications", error);
                }
            }

        } catch (err) {
            console.error("Failed to save job card", err)
            setError(activeDocId ? "Failed to update job card." : "Failed to create new job card.")
        } finally {
            setLoading(false)
        }
    }

    const handleMarketingManagerApproval = async () => {
        setCustomerData((prev: any) => ({ ...prev, marketingManagerSignature: true }));
        setIsMarketingApprovalModalOpen(false);

        // Save the change and advance phase if needed
        setLoading(true);
        try {
            const docRef = doc(db, 'job_cards', activeDocId!);

            // Advance phase to 2
            setPhaseStatuses((prev: any) => ({ ...prev, 1: 'completed' }));
            setCurrentPhase(2);
            setActiveTab(2);

            await updateDoc(docRef, {
                customerData: { ...customerData, marketingManagerSignature: true },
                'phaseStatuses.1': 'completed',
                currentPhase: 2,
                updatedAt: serverTimestamp()
            });

            // Notify Pre-Press that phase 2 is ready
            const notificationMsg = `Job Card ${jobCardNo} Phase 1 approved by Marketing Manager. Ready for Phase 2.`;
            await sendNotification(2, notificationMsg, jobCardNo, activeDocId);

            if (window.electron && window.electron.ipcRenderer) {
                window.electron.ipcRenderer.send('log-to-terminal', `Marketing Manager approved Job Card ${jobCardNo}`);
            }
        } catch (error) {
            console.error("Error saving Marketing Manager approval:", error);
            setError("Failed to save approval.");
        } finally {
            setLoading(false);
        }
    } // end of handleMarketingManagerApproval

    const handleSaveOnly = async () => {
        setLoading(true)
        setError('')
        try {
            const dataToSave = {
                jobCardNo, jobCardDate, targetDate,
                currentPhase,
                phaseStatuses,
                status,
                customerData, requirements, otherSpecs,
                phase2Data, phase3Data, phase4Data, phase5Data, phase6Data, phase7Data, phase8Data,
                updatedAt: serverTimestamp()
            }

            if (!activeDocId) {
                const docRef = doc(collection(db, 'job_cards'))
                await setDoc(docRef, {
                    ...dataToSave,
                    id: docRef.id,
                    createdAt: serverTimestamp(),
                    createdBy: user?.uid
                })
                setActiveDocId(docRef.id)
            } else {
                const docRef = doc(db, 'job_cards', activeDocId)
                await updateDoc(docRef, dataToSave)
            }

            onClose()
        } catch (err: any) {
            console.error(err)
            setError(err.message || 'Failed to save Job Card')
        } finally {
            setLoading(false)
        }
    }

    const renderFilePreview = (url: string | undefined, name: string | undefined, loadingField: string) => {
        if (fieldLoading[loadingField]) {
            return (
                <div className="flex items-center gap-2 text-blue-600 animate-pulse text-xs font-bold mt-1">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Uploading...
                </div>
            )
        }

        if (!url) return null;

        const isImage = url.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)/) || 
                       (name && name.toLowerCase().match(/\.(jpg|jpeg|png|gif|webp)$/)) ||
                       url.includes('image');

        return (
            <div className="mt-2 p-2 border rounded bg-gray-50 flex items-center gap-3 shadow-sm border-blue-100">
                {isImage ? (
                    <div className="w-12 h-12 rounded border overflow-hidden bg-white shrink-0 shadow-inner">
                        <img src={url} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                ) : (
                    <div className="w-12 h-12 rounded border bg-white flex items-center justify-center shrink-0 shadow-inner">
                        <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg>
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-1">Uploaded Attachment</p>
                    <p className="text-xs font-semibold text-gray-700 truncate">{name || 'File Attached'}</p>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 hover:underline text-xs font-bold flex items-center gap-1 mt-1 transition-colors">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        View Full File
                    </a>
                </div>
            </div>
        )
    }

    const renderPhaseHeader = (phaseNum: number, title: string) => {
        const pStatus = phaseStatuses[phaseNum];
        let statusColor: string = 'bg-gray-400';
        let statusText: string = 'Pending';
        if (pStatus === 'completed') { statusColor = 'bg-green-500'; statusText = 'Completed'; }
        if (pStatus === 'needs_reconfirmation') { statusColor = 'bg-orange-500'; statusText = 'Needs Reconfirm'; }

        return (
            <button
                onClick={() => setActiveTab(activeTab === phaseNum ? 0 : phaseNum)}
                className="w-full flex justify-between items-center bg-gray-200 px-6 py-4 font-bold text-gray-800 hover:bg-gray-300 transition"
            >
                <div className="flex items-center gap-3">
                    <span className={`w-8 h-8 rounded-full text-sm flex font-bold items-center justify-center text-white ${statusColor}`}>
                        {phaseNum}
                    </span>
                    <span>{title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded text-white ${statusColor}`}>{statusText}</span>
                </div>
                <svg className={`w-5 h-5 transform transition ${activeTab === phaseNum ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
        )
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto">
            <div className="bg-gray-100 rounded-lg shadow-xl w-full max-w-6xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b bg-white rounded-t-lg sticky top-0 z-10 shadow-sm">
                    <h2 className="text-xl font-bold text-gray-800">
                        {activeDocId ? `Job Card: ${jobCardNo}` : 'Create New Job Card'}
                        <span className={`ml-3 text-sm px-2 py-1 rounded inline-block translate-y-[-2px] ${status?.toLowerCase() === 'completed' ? 'bg-green-100 text-green-800' :
                            status?.toLowerCase() === 'cancelled' ? 'bg-red-100 text-red-800' :
                                'bg-yellow-100 text-yellow-800'
                            }`}>
                            {status}
                        </span>
                    </h2>
                    <div className="flex gap-2">
                        {/* Only show Generate PDF if Job Card has an ID (is saved) */}
                        {activeDocId && (
                            <button
                                onClick={async () => {
                                    setLoading(true);
                                    try {
                                        // Wait a moment for any pending state updates to flush
                                        await new Promise(resolve => setTimeout(resolve, 500));

                                        // Create a comprehensive data object that matches exactly what the PDF generator expects
                                        const docData = {
                                            jobCardNo,
                                            jobCardDate,
                                            targetDate,
                                            customerData,
                                            requirements,
                                            otherSpecs,
                                            phase2Data: {
                                                ...phase2Data,
                                                comments: phase2Data.comments || '',
                                                prePressChecklist: phase2Data.prePressChecklist || {},
                                                ...(phase2Data.marketingManagerSignature ? { marketingManagerSignature: true } : {})
                                            },
                                            phase3Data,
                                            phase4Data,
                                            phase5Data,
                                            phase6Data,
                                            phase7Data,
                                            phase8Data,
                                            status
                                        };

                                        // Use the shared generator
                                        await generateJobCardPdf(docData, {}, 'print');
                                    } catch (error) {
                                        console.error("PDF Generation failed:", error);
                                        setError("Failed to generate PDF. See console for details.");
                                    } finally {
                                        setLoading(false);
                                    }
                                }}
                                disabled={loading}
                                className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded shadow transition-colors flex items-center gap-2"
                                title="Generate PDF"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                </svg>
                            </button>
                        )}
                        {(status?.toLowerCase() !== 'completed' || ['admin', 'marketing_manager'].includes(user?.role || '')) && (
                            <button onClick={handleSaveOnly} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow font-bold text-sm transition">
                                Save Only
                            </button>
                        )}
                        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50 flex gap-6">
                    {/* Left Column: Form Sections */}
                    <div className="flex-1 space-y-6">

                        {error && (
                            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
                                {error}
                            </div>
                        )}

                        {/* Phase 1 Accordion */}
                        <div className="bg-white p-6 shadow rounded">
                            <div className="grid grid-cols-3 gap-6">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">Job Card Date</label>
                                    <input type="date" value={jobCardDate} onChange={e => setJobCardDate(e.target.value)} disabled={!canEditPhase(1)} className="w-full border rounded p-2 focus:ring focus:ring-blue-200 disabled:bg-gray-100" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">Target Date</label>
                                    <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} disabled={!canEditPhase(1)} className="w-full border rounded p-2 focus:ring focus:ring-blue-200 disabled:bg-gray-100" />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">Job Card No.</label>
                                    <input type="text" value={jobCardNo} onChange={e => setJobCardNo(e.target.value)} disabled={!canEditPhase(1)} placeholder="Auto-generated if empty" className="w-full border rounded p-2 focus:ring focus:ring-blue-200 disabled:bg-gray-100" />
                                </div>
                            </div>
                        </div>

                        {/* Phase 1 Accordion */}
                        <div className="bg-white shadow rounded overflow-hidden">
                            {renderPhaseHeader(1, "Initiation (Customer Data & Requirements)")}
                            {activeTab === 1 && (
                                <div className="p-6 border-t border-gray-200">
                                    <div className="space-y-6">
                                        {/* Customer Data */}
                                        <div className="border rounded p-4 relative">
                                            <h4 className="absolute -top-3 left-4 bg-white px-2 text-sm font-bold text-gray-600">Customer Data</h4>
                                            <div className="grid grid-cols-4 gap-4 mt-2">
                                                <div className="col-span-2 relative z-[60]">
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Customer Name</label>
                                                    <SearchableDropdown
                                                        options={buyers.map(b => ({ id: b.name, label: b.name }))}
                                                        value={customerData.customerName}
                                                        onChange={val => setCustomerData({ ...customerData, customerName: val as string })}
                                                        placeholder="Search Customer..."
                                                        disabled={!canEditPhase(1)}
                                                    />
                                                </div>
                                                <div className="col-span-2 relative z-[50]">
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Job Name (Product)</label>
                                                    <SearchableDropdown
                                                        options={products.map(p => ({ id: p.description, label: p.description }))}
                                                        value={customerData.jobName}
                                                        onChange={val => {
                                                            const newVal = val as string;
                                                            setCustomerData({ ...customerData, jobName: newVal });
                                                            if (customerData.newOrRepeat === 'Repeat') {
                                                                fetchExistingJobCardData(newVal, true);
                                                            }
                                                        }}
                                                        placeholder="Search Product..."
                                                        disabled={!canEditPhase(1)}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">New/Repeat</label>
                                                    <select
                                                        value={customerData.newOrRepeat}
                                                        onChange={e => {
                                                            const newVal = e.target.value;
                                                            setCustomerData({ ...customerData, newOrRepeat: newVal });
                                                            if (newVal === 'Repeat' && customerData.jobName) {
                                                                fetchExistingJobCardData(customerData.jobName, true);
                                                            }
                                                        }}
                                                        disabled={!canEditPhase(1)}
                                                        className="w-full border rounded p-2 text-sm disabled:bg-gray-50"
                                                    >
                                                        <option>New</option>
                                                        <option>Repeat</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">PO Date</label>
                                                    <input type="date" value={customerData.poDate} onChange={e => setCustomerData({ ...customerData, poDate: e.target.value })} disabled={!canEditPhase(1)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">PO Quantity</label>
                                                    <input type="number" value={customerData.poQuantity} onChange={e => setCustomerData({ ...customerData, poQuantity: e.target.value })} disabled={!canEditPhase(1)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">P.O. No.</label>
                                                    <input type="text" value={customerData.poNo} onChange={e => setCustomerData({ ...customerData, poNo: e.target.value })} disabled={!canEditPhase(1)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Tolerance (Qty)</label>
                                                    <input type="number" value={customerData.tolerance} onChange={e => setCustomerData({ ...customerData, tolerance: e.target.value })} disabled={!canEditPhase(1)} placeholder="e.g. 500" className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div className="col-span-4 mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
                                                    <div className="flex justify-between items-center mb-3">
                                                        <h5 className="text-sm font-bold text-gray-700">Variants (Multiple Entries Allowed)</h5>
                                                        {canEditPhase(1) && (
                                                            <button
                                                                onClick={addVariant}
                                                                className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 transition font-bold"
                                                            >
                                                                + Add Variant
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="space-y-3">
                                                        {(customerData.variants || []).length === 0 ? (
                                                            <p className="text-xs text-gray-400 italic">No variants added yet. (Optional)</p>
                                                        ) : (
                                                            (customerData.variants || []).map((v: any) => (
                                                                <div key={v.id} className="flex gap-4 items-end bg-white p-2 rounded border shadow-sm">
                                                                    <div className="flex-1">
                                                                        <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Variant Name</label>
                                                                        <input
                                                                            type="text"
                                                                            value={v.name}
                                                                            onChange={e => updateVariant(v.id, 'name', e.target.value)}
                                                                            disabled={!canEditPhase(1)}
                                                                            placeholder="e.g. Vanilla, Chocolate"
                                                                            className="w-full border rounded p-1 text-sm bg-white"
                                                                        />
                                                                    </div>
                                                                    <div className="w-32">
                                                                        <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Quantity</label>
                                                                        <input
                                                                            type="number"
                                                                            value={v.quantity}
                                                                            onChange={e => updateVariant(v.id, 'quantity', e.target.value)}
                                                                            disabled={!canEditPhase(1)}
                                                                            placeholder="Qty"
                                                                            className="w-full border rounded p-1 text-sm bg-white"
                                                                        />
                                                                    </div>
                                                                    {canEditPhase(1) && (
                                                                        <button onClick={() => deleteVariant(v.id)} className="text-red-400 hover:text-red-600 p-1">
                                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="col-span-2 mt-4">
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">PO Hard Copy (PDF, PNG, JPG)</label>
                                                    <div className="flex flex-col gap-1">
                                                        <input 
                                                            type="file" 
                                                            accept=".pdf,.png,.jpg,.jpeg" 
                                                            onChange={(e) => handleFileUpload(e, 'po_files', 'poFileUrl', setCustomerData)}
                                                            disabled={!canEditPhase(1)}
                                                            className="text-xs border rounded p-1 w-full bg-white disabled:bg-gray-50 focus:ring-1 focus:ring-blue-400 outline-none"
                                                        />
                                                        {renderFilePreview(customerData.poFileUrl, customerData.poFileName, 'poFileUrl')}
                                                    </div>
                                                </div>
                                                <div className="col-span-2 mt-4">
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Sample File (In Phase 1)</label>
                                                    <div className="flex flex-col gap-1">
                                                        <input 
                                                            type="file" 
                                                            accept=".pdf,.png,.jpg,.jpeg" 
                                                            onChange={(e) => handleFileUpload(e, 'sample_files', 'sampleFileUrl', setCustomerData)}
                                                            disabled={!canEditPhase(1)}
                                                            className="text-xs border rounded p-1 w-full bg-white disabled:bg-gray-50 focus:ring-1 focus:ring-blue-400 outline-none"
                                                        />
                                                        {renderFilePreview(customerData.sampleFileUrl, customerData.sampleFileName, 'sampleFileUrl')}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Requirements - Category Selection */}
                                        <div className="border rounded p-4 relative mt-6">
                                            <h4 className="absolute -top-3 left-4 bg-white px-2 text-sm font-bold text-gray-600">Product Category</h4>
                                            <div className="mt-2 text-sm z-20 relative w-1/2">
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Select Category</label>
                                                <SearchableDropdown
                                                    options={categories.map(c => ({ id: c.id, label: c.name }))}
                                                    value={requirements.categoryId}
                                                    onChange={(val) => {
                                                        const cat = categories.find(c => c.id === val);
                                                        setRequirements({
                                                            ...requirements,
                                                            categoryId: val as string,
                                                            categoryName: cat ? cat.name : ''
                                                        });
                                                    }}
                                                    placeholder="Search category..."
                                                    disabled={!canEditPhase(1)}
                                                />
                                            </div>
                                        </div>

                                        {/* Requirements - Tables */}
                                        {requirements.categoryId && (
                                            <div className="border rounded p-4 relative mt-6 z-10 transition-all">
                                                <h4 className="absolute -top-3 left-4 bg-white px-2 text-sm font-bold text-gray-600">Requirements Details (For {requirements.categoryName})</h4>
                                                <div className={`grid ${requirements.categoryName?.trim().toLowerCase() === 'catalogue' ? 'grid-cols-2' : 'grid-cols-1'} gap-8 mt-2`}>
                                                    {/* Title Page */}
                                                    <div>
                                                        <h5 className="font-bold text-sm text-gray-700 mb-4 border-b pb-1">Title Page (For {requirements.categoryName})</h5>
                                                        <div className="space-y-2">
                                                            {['gsm', 'materialType', 'printingType', 'noOfColours', 'lamination', 'coating', 'texture', 'uvDripOff', 'embossing', 'foiling', 'binding'].map(field => (
                                                                <div key={field} className="grid grid-cols-2 items-center gap-2">
                                                                    <label className="text-xs text-gray-600 capitalize">{field.replace(/([A-Z])/g, ' $1').trim()}</label>
                                                                    {field === 'materialType' ? (
                                                                        <select
                                                                            value={requirements.titlePage[field as keyof typeof requirements.titlePage]}
                                                                            onChange={e => setRequirements({
                                                                                ...requirements,
                                                                                titlePage: { ...requirements.titlePage, [field]: e.target.value }
                                                                            })}
                                                                            disabled={!canEditPhase(1)}
                                                                            className="border rounded px-2 py-1 text-sm disabled:bg-gray-50 w-full"
                                                                        >
                                                                            <option value="">Select Material</option>
                                                                            {MATERIAL_TYPES.map(mat => (
                                                                                <option key={mat} value={mat}>{mat}</option>
                                                                            ))}
                                                                        </select>
                                                                    ) : field === 'printingType' ? (
                                                                        <select
                                                                            value={requirements.titlePage[field as keyof typeof requirements.titlePage]}
                                                                            onChange={e => setRequirements({
                                                                                ...requirements,
                                                                                titlePage: { ...requirements.titlePage, [field]: e.target.value }
                                                                            })}
                                                                            disabled={!canEditPhase(1)}
                                                                            className="border rounded px-2 py-1 text-sm disabled:bg-gray-50 w-full"
                                                                        >
                                                                            <option value="">Select Printing</option>
                                                                            <option value="Single side">Single side</option>
                                                                            <option value="Double side (Lot-pot)">Double side (Lot-pot)</option>
                                                                        </select>
                                                                    ) : (
                                                                        <input
                                                                            type="text"
                                                                            value={requirements.titlePage[field as keyof typeof requirements.titlePage]}
                                                                            onChange={e => setRequirements({
                                                                                ...requirements,
                                                                                titlePage: { ...requirements.titlePage, [field]: e.target.value }
                                                                            })}
                                                                            disabled={!canEditPhase(1)}
                                                                            className="border rounded px-2 py-1 text-sm disabled:bg-gray-50 w-full"
                                                                        />
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Inner Pages */}
                                                    {requirements.categoryName?.trim().toLowerCase() === 'catalogue' && (
                                                        <div>
                                                            <h5 className="font-bold text-sm text-gray-700 mb-3 border-b pb-1">Inner Pages (For {requirements.categoryName})</h5>
                                                            <div className="space-y-2">
                                                                {['gsm', 'materialType', 'printingType', 'noOfColours', 'lamination', 'coating', 'texture', 'uvDripOff', 'embossing', 'foiling', 'binding'].map(field => (
                                                                    <div key={field} className="grid grid-cols-2 items-center gap-2">
                                                                        <label className="text-xs text-gray-600 capitalize">{field.replace(/([A-Z])/g, ' $1').trim()}</label>
                                                                        {field === 'materialType' ? (
                                                                            <select
                                                                                value={requirements.innerPages[field as keyof typeof requirements.innerPages]}
                                                                                onChange={e => setRequirements({
                                                                                    ...requirements,
                                                                                    innerPages: { ...requirements.innerPages, [field]: e.target.value }
                                                                                })}
                                                                                disabled={!canEditPhase(1)}
                                                                                className="border rounded px-2 py-1 text-sm disabled:bg-gray-50 w-full"
                                                                            >
                                                                                <option value="">Select Material</option>
                                                                                {MATERIAL_TYPES.map(mat => (
                                                                                    <option key={mat} value={mat}>{mat}</option>
                                                                                ))}
                                                                            </select>
                                                                        ) : field === 'printingType' ? (
                                                                            <select
                                                                                value={requirements.innerPages[field as keyof typeof requirements.innerPages]}
                                                                                onChange={e => setRequirements({
                                                                                    ...requirements,
                                                                                    innerPages: { ...requirements.innerPages, [field]: e.target.value }
                                                                                })}
                                                                                disabled={!canEditPhase(1)}
                                                                                className="border rounded px-2 py-1 text-sm disabled:bg-gray-50 w-full"
                                                                            >
                                                                                <option value="">Select Printing</option>
                                                                                <option value="Single side">Single side</option>
                                                                                <option value="Double side (Lot-pot)">Double side (Lot-pot)</option>
                                                                            </select>
                                                                        ) : (
                                                                            <input
                                                                                type="text"
                                                                                value={requirements.innerPages[field as keyof typeof requirements.innerPages]}
                                                                                onChange={e => setRequirements({
                                                                                    ...requirements,
                                                                                    innerPages: { ...requirements.innerPages, [field]: e.target.value }
                                                                                })}
                                                                                disabled={!canEditPhase(1)}
                                                                                className="border rounded px-2 py-1 text-sm disabled:bg-gray-50 w-full"
                                                                            />
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex gap-6 mt-6">
                                            <div className="flex-1 border rounded p-4 relative shadow-sm">
                                                <h4 className="absolute -top-3 left-4 bg-white px-2 text-sm font-bold text-gray-600">Other Specifications</h4>
                                                <div className="mt-2">
                                                    <textarea
                                                        value={otherSpecs}
                                                        onChange={e => setOtherSpecs(e.target.value)}
                                                        disabled={!canEditPhase(1)}
                                                        className="w-full border rounded p-3 text-sm disabled:bg-gray-50 h-24 resize-y focus:ring-2 focus:ring-blue-400 focus:outline-none"
                                                        placeholder="Enter other specifications..."
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Phase 1 Comments */}
                                        <div className="mt-4 border rounded p-4 relative shadow-sm">
                                            <h4 className="absolute -top-3 left-4 bg-white px-2 text-sm font-bold text-gray-600">Phase 1 Comments</h4>
                                            <textarea
                                                value={customerData.comments}
                                                onChange={e => setCustomerData({ ...customerData, comments: e.target.value })}
                                                disabled={!canEditPhase(1)}
                                                className="w-full border rounded p-2 text-sm disabled:bg-gray-50 h-20 resize-none focus:ring-1 focus:ring-blue-400 focus:outline-none"
                                                placeholder="Add comments for Phase 1..."
                                            />
                                        </div>

                                        {/* Complete Phase Button */}
                                        {canEditPhase(1) && (
                                            <div className="flex justify-end mt-6 border-t pt-4">
                                                <button
                                                    onClick={() => triggerConfirm(1)}
                                                    disabled={loading}
                                                    className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded shadow font-bold text-sm transition disabled:opacity-50"
                                                >
                                                    {phaseStatuses[1] === 'completed' ? 'Update & Confirm Phase 1' : 'Confirm Phase 1'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Phase 2 Accordion */}
                        <div className="bg-white shadow rounded overflow-hidden">
                            {renderPhaseHeader(2, "Pre Press")}
                            {activeTab === 2 && (
                                <div className="p-6 border-t border-gray-200">
                                    {!isPhaseUnlocked(2) ? (
                                        <p className="text-gray-500 italic">
                                            This phase is locked. {phaseStatuses[1] === 'completed' ? 'Marketing Manager approval for Phase 1 is required.' : 'Phase 1 must be completed first.'}
                                        </p>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Plates</label>
                                                    <input type="text" value={phase2Data.plates} onChange={e => setPhase2Data({ ...phase2Data, plates: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Positive UV</label>
                                                    <input type="text" value={phase2Data.positiveUV} onChange={e => setPhase2Data({ ...phase2Data, positiveUV: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Positive Die</label>
                                                    <input type="text" value={phase2Data.positiveDie} onChange={e => setPhase2Data({ ...phase2Data, positiveDie: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Positive Foil</label>
                                                    <input type="text" value={phase2Data.positiveFoil} onChange={e => setPhase2Data({ ...phase2Data, positiveFoil: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Embossing Black Positive</label>
                                                    <input type="text" value={phase2Data.embossingBlackPositive} onChange={e => setPhase2Data({ ...phase2Data, embossingBlackPositive: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Shade Cards</label>
                                                    <input type="text" value={phase2Data.shadeCard} onChange={e => setPhase2Data({ ...phase2Data, shadeCard: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Ups</label>
                                                    <input type="text" value={phase2Data.ups} onChange={e => setPhase2Data({ ...phase2Data, ups: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div className="col-span-1">
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Sheet Size</label>
                                                    <div className="grid grid-cols-3 gap-1">
                                                        <input 
                                                            type="text" 
                                                            placeholder="L" 
                                                            value={phase2Data.sheetSizeL || ''} 
                                                            onChange={e => setPhase2Data({ ...phase2Data, sheetSizeL: e.target.value })} 
                                                            disabled={!canEditPhase(2)} 
                                                            className="w-full border rounded p-2 text-sm disabled:bg-gray-50" 
                                                        />
                                                        <input 
                                                            type="text" 
                                                            placeholder="W" 
                                                            value={phase2Data.sheetSizeW || ''} 
                                                            onChange={e => setPhase2Data({ ...phase2Data, sheetSizeW: e.target.value })} 
                                                            disabled={!canEditPhase(2)} 
                                                            className="w-full border rounded p-2 text-sm disabled:bg-gray-50" 
                                                        />
                                                        <input 
                                                            type="text" 
                                                            placeholder="GSM" 
                                                            value={phase2Data.sheetSizeGsm || ''} 
                                                            onChange={e => setPhase2Data({ ...phase2Data, sheetSizeGsm: e.target.value })} 
                                                            disabled={!canEditPhase(2)} 
                                                            className="w-full border rounded p-2 text-sm disabled:bg-gray-50" 
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Finished Size</label>
                                                    <input type="text" value={phase2Data.finishedSize} onChange={e => setPhase2Data({ ...phase2Data, finishedSize: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Number of Pages</label>
                                                    <input type="text" value={phase2Data.numberOfPages} onChange={e => setPhase2Data({ ...phase2Data, numberOfPages: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Digital Dummy</label>
                                                    <input type="text" value={phase2Data.digitalDummy} onChange={e => setPhase2Data({ ...phase2Data, digitalDummy: e.target.value })} disabled={!canEditPhase(2)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" />
                                                </div>
                                                <div className="col-span-full">
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Sample File (In Phase 2)</label>
                                                    <div className="flex flex-col gap-1">
                                                        <input 
                                                            type="file" 
                                                            accept=".pdf,.png,.jpg,.jpeg" 
                                                            onChange={(e) => handleFileUpload(e, 'sample_files', 'sampleFileUrl', setPhase2Data)}
                                                            disabled={!canEditPhase(2)}
                                                            className="text-xs border rounded p-1 w-full bg-white disabled:bg-gray-50 focus:ring-1 focus:ring-blue-400 outline-none"
                                                        />
                                                        {renderFilePreview(phase2Data.sampleFileUrl, phase2Data.sampleFileName, 'sampleFileUrl')}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Phase 2 Comments</label>
                                                    <textarea
                                                        value={phase2Data.comments}
                                                        onChange={e => setPhase2Data({ ...phase2Data, comments: e.target.value })}
                                                        disabled={!canEditPhase(2)}
                                                        className="w-full border rounded p-2 text-sm disabled:bg-gray-50 h-20 resize-none"
                                                        placeholder="Add comments for Phase 2..."
                                                    />
                                                </div>
                                            </div>

                                            {canEditPhase(2) && (
                                                <div className="flex justify-end mt-4 border-t pt-4">
                                                    <button onClick={() => triggerConfirm(2)} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded shadow font-bold text-sm transition disabled:opacity-50">
                                                        {phaseStatuses[2] === 'completed' ? 'Update & Confirm Phase 2' : 'Confirm Phase 2'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Phase 3 Accordion */}
                        <div className="bg-white shadow rounded overflow-hidden">
                            {renderPhaseHeader(3, "Procurement")}
                            {activeTab === 3 && (
                                <div className="p-6 border-t border-gray-200">
                                    {!isPhaseUnlocked(3) ? (
                                        <p className="text-gray-500 italic">This phase is locked. Phase 2 must be completed first.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4 text-blue-800 text-sm font-semibold">
                                                ℹ️ This phase is automatically completed when a Raw Material Purchase Order (Paper & Board) is created and linked to this Job Card.
                                                Manual entry is disabled.
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 opacity-75 pointer-events-none">
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Material Type</label>
                                                    <input type="text" value={phase3Data.materialType} readOnly className="w-full border rounded p-2 text-sm bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Material Size</label>
                                                    <input type="text" value={phase3Data.materialSize} readOnly className="w-full border rounded p-2 text-sm bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">GSM</label>
                                                    <input type="text" value={phase3Data.gsm} readOnly className="w-full border rounded p-2 text-sm bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Number of Sheets</label>
                                                    <input type="text" value={phase3Data.noOfSheets} readOnly className="w-full border rounded p-2 text-sm bg-gray-50" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 mb-1">Phase 3 Comments</label>
                                                    <textarea
                                                        value={phase3Data.comments}
                                                        readOnly
                                                        className="w-full border rounded p-2 text-sm bg-gray-50 h-20 resize-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Phase 4 Accordion - Store */}
                        <div className="bg-white shadow rounded overflow-hidden">
                            {renderPhaseHeader(4, "Store")}
                            {activeTab === 4 && (
                                <div className="p-6 border-t border-gray-200">
                                    {!isPhaseUnlocked(4) ? (
                                        <p className="text-gray-500 italic">This phase is locked. Phase 3 must be completed first.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4 text-blue-800 text-sm font-semibold">
                                                ℹ️ This phase displays Raw Material Issue/Adjustment transactions linked to this Job Card.
                                                Entries are made from the Inventory tab.
                                            </div>
                                            <div className="overflow-x-auto bg-white rounded border shadow-sm">
                                                <table className="min-w-full text-xs text-left">
                                                    <thead className="bg-gray-100 text-gray-600 font-bold uppercase">
                                                        <tr>
                                                            <th className="px-3 py-2">Date</th>
                                                            <th className="px-3 py-2">Doc/GRN No</th>
                                                            <th className="px-3 py-2">Type</th>
                                                            <th className="px-3 py-2">Category</th>
                                                            <th className="px-3 py-2">Product</th>
                                                            <th className="px-3 py-2">Qty</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-100">
                                                        {(!phase4Data.storeLogs || phase4Data.storeLogs.length === 0) ? (
                                                            <tr>
                                                                <td colSpan={6} className="px-3 py-4 text-center text-gray-400 italic">No inventory entries recorded yet.</td>
                                                            </tr>
                                                        ) : (
                                                            phase4Data.storeLogs.map((log: any) => (
                                                                <tr key={log.id} className="hover:bg-gray-50">
                                                                    <td className="px-3 py-2">{log.date}</td>
                                                                    <td className="px-3 py-2">{log.grn_no || '-'}</td>
                                                                    <td className="px-3 py-2">
                                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${log.transaction_type === 'Issue' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                                                                            {log.transaction_type}
                                                                        </span>
                                                                    </td>
                                                                    <td className="px-3 py-2">{log.category_name}</td>
                                                                    <td className="px-3 py-2 font-medium">{log.product_name}</td>
                                                                    <td className="px-3 py-2 font-bold">{log.quantity}</td>
                                                                </tr>
                                                            ))
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div className="mt-4 border-t pt-4">
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Phase 1 Comments</label>
                                                <textarea
                                                    value={customerData.comments}
                                                    onChange={e => setCustomerData({ ...customerData, comments: e.target.value })}
                                                    disabled={!canEditPhase(1)}
                                                    className="w-full border rounded p-2 text-sm disabled:bg-gray-50 h-20 resize-none"
                                                    placeholder="Add comments for Phase 1..."
                                                />
                                            </div>

                                            {/* Status Message for Phase 1 Approval */}
                                            {phaseStatuses[1] === 'completed' && !customerData.marketingManagerSignature && (
                                                <div className="mt-4 bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded flex items-center justify-between shadow-sm">
                                                    <div className="flex items-center gap-2">
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                                        <span className="text-sm font-medium">Waiting for Marketing Manager approval before Phase 2 can begin.</span>
                                                    </div>
                                                    {user?.role === 'marketing_manager' && (
                                                        <button
                                                            onClick={() => setIsMarketingApprovalModalOpen(true)}
                                                            disabled={loading}
                                                            className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-1.5 rounded shadow text-sm font-bold transition disabled:opacity-50"
                                                        >
                                                            Approve Phase 1
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {customerData.marketingManagerSignature && (
                                                <div className="mt-4 bg-green-50 border border-green-200 text-green-800 p-3 rounded flex items-center gap-2 shadow-sm">
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    <span className="text-sm font-medium">Approved by Marketing Manager</span>
                                                </div>
                                            )}

                                            {canEditPhase(1) && (
                                                <div className="flex justify-end mt-4 border-t pt-4">
                                                    <button onClick={() => triggerConfirm(1)} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded shadow font-bold text-sm transition disabled:opacity-50">
                                                        {phaseStatuses[1] === 'completed' ? 'Update & Confirm Phase 1' : 'Confirm Phase 1'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Phase 5 Accordion */}
                        <div className="bg-white shadow rounded overflow-hidden">
                            {renderPhaseHeader(5, "Production")}
                            {activeTab === 5 && (
                                <div className="p-6 border-t border-gray-200">
                                    {!isPhaseUnlocked(5) ? (
                                        <p className="text-gray-500 italic">This phase is locked. Phase 4 must be completed first.</p>
                                    ) : (
                                        <div className="space-y-8">
                                            <div className="border rounded-lg p-4 bg-gray-50/50">
                                                <h3 className="text-sm font-bold text-blue-800 mb-4 flex items-center gap-2">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                                                    Production Logs
                                                </h3>

                                                {/* Allowed Wastage Input */}
                                                <div className="mb-6 bg-white p-4 rounded border shadow-sm flex items-end gap-6">
                                                    <div className="flex-1">
                                                        <label className="block text-sm font-bold text-gray-700 mb-2">1st Add Allowed Wastage (Qty Amount)</label>
                                                        <div className="flex gap-2">
                                                            <input
                                                                type="number"
                                                                value={phase5Data.allowedWastage}
                                                                onChange={e => setPhase5Data({ ...phase5Data, allowedWastage: e.target.value })}
                                                                disabled={!canEditPhase(5) || (phase5Data.productionLogs && phase5Data.productionLogs.length > 0)}
                                                                placeholder="Enter allowed wastage quantity..."
                                                                className="flex-1 border rounded p-2 focus:ring focus:ring-blue-200 disabled:bg-gray-100"
                                                            />
                                                            {phase5Data.productionLogs && phase5Data.productionLogs.length > 0 && (
                                                                <p className="text-[10px] text-orange-600 mt-1 font-medium italic">Cannot change allowed wastage once logs are added.</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-4 w-1/2">
                                                        <div className="bg-gray-50 p-2 rounded border">
                                                            <label className="block text-[10px] uppercase font-bold text-gray-500">Actual Wastage</label>
                                                            <div className="text-lg font-bold text-gray-800">
                                                                {(phase5Data.productionLogs || []).reduce((sum: number, log: any) => sum + Number(log.waste || 0), 0)}
                                                            </div>
                                                        </div>
                                                        <div className="bg-gray-50 p-2 rounded border">
                                                            <label className="block text-[10px] uppercase font-bold text-gray-500">Excess Wastage</label>
                                                            <div className="text-lg font-bold text-red-600">
                                                                {Math.max(0, (phase5Data.productionLogs || []).reduce((sum: number, log: any) => sum + Number(log.waste || 0), 0) - Number(phase5Data.allowedWastage || 0))}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Production Table */}
                                                <div className="overflow-x-auto mb-4 bg-white rounded border shadow-sm">
                                                    <table className="min-w-full text-xs text-left">
                                                        <thead className="bg-gray-100 text-gray-600 font-bold uppercase track-wider">
                                                            <tr>
                                                                <th className="px-3 py-2">Start</th>
                                                                <th className="px-3 py-2">End</th>
                                                                <th className="px-3 py-2">Machine</th>
                                                                <th className="px-3 py-2">Shift</th>
                                                                <th className="px-3 py-2">Operator</th>
                                                                <th className="px-3 py-2">Assigned Sheets</th>
                                                                <th className="px-3 py-2 text-blue-600">Prod</th>
                                                                <th className="px-3 py-2 text-red-500">Waste</th>
                                                                <th className="px-3 py-2 w-10"></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100">
                                                            {(!phase5Data.productionLogs || phase5Data.productionLogs.length === 0) ? (
                                                                <tr>
                                                                    <td colSpan={9} className="px-3 py-4 text-center text-gray-400 italic">No production logs recorded yet.</td>
                                                                </tr>
                                                            ) : (
                                                                phase5Data.productionLogs.map((log: any) => (
                                                                    <tr key={log.id} className="hover:bg-gray-50">
                                                                        <td className="px-3 py-2">{log.startTime}</td>
                                                                        <td className="px-3 py-2">{log.endTime}</td>
                                                                        <td className="px-3 py-2">{log.machine}</td>
                                                                        <td className="px-3 py-2">{log.shift}</td>
                                                                        <td className="px-3 py-2">{log.operator}</td>
                                                                        <td className="px-3 py-2 font-semibold">{log.assignedSheets}</td>
                                                                        <td className="px-3 py-2 font-bold text-blue-600">{log.productionQty}</td>
                                                                        <td className="px-3 py-2 text-red-500">{log.waste}</td>
                                                                        <td className="px-3 py-2">
                                                                            {canEditPhase(5) && (
                                                                                <button onClick={() => deleteProductionLog(log.id)} className="text-red-400 hover:text-red-600 shrink-0">
                                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                                </button>
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                ))
                                                            )}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                {/* Add Production Log Form */}
                                                {canEditPhase(5) && (
                                                    <div className="flex flex-col gap-3 bg-blue-50/50 p-4 rounded border border-blue-100">
                                                        <div className="grid grid-cols-4 gap-3">
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Start Time</label>
                                                                <input type="datetime-local" value={newProductionLog.startTime} onChange={e => setNewProductionLog({ ...newProductionLog, startTime: e.target.value })} className="w-full border rounded p-1.5 text-xs bg-white" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">End Time</label>
                                                                <input type="datetime-local" value={newProductionLog.endTime} onChange={e => setNewProductionLog({ ...newProductionLog, endTime: e.target.value })} className="w-full border rounded p-1.5 text-xs bg-white" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Machine</label>
                                                                <select
                                                                    value={newProductionLog.machine}
                                                                    onChange={e => setNewProductionLog({ ...newProductionLog, machine: e.target.value })}
                                                                    className="w-full border rounded p-1.5 text-xs bg-white"
                                                                >
                                                                    <option value="">Select Machine</option>
                                                                    {PRODUCTION_MACHINES.map(m => (
                                                                        <option key={m} value={m}>{m}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Shift</label>
                                                                <select value={newProductionLog.shift} onChange={e => setNewProductionLog({ ...newProductionLog, shift: e.target.value })} className="w-full border rounded p-1.5 text-xs bg-white">
                                                                    <option value="">Select Shift</option>
                                                                    <option value="Day">Day</option>
                                                                    <option value="Night">Night</option>
                                                                </select>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-5 gap-3 items-end">
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Operator</label>
                                                                <input type="text" value={newProductionLog.operator} onChange={e => setNewProductionLog({ ...newProductionLog, operator: e.target.value })} className="w-full border rounded p-1.5 text-xs bg-white" placeholder="Name" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Assigned Sheets</label>
                                                                <input type="number" value={newProductionLog.assignedSheets} onChange={e => setNewProductionLog({ ...newProductionLog, assignedSheets: e.target.value })} className="w-full border rounded p-1.5 text-xs bg-white text-blue-700 font-semibold" placeholder="Sheets" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 text-blue-600">Prod Qty</label>
                                                                <input type="number" value={newProductionLog.productionQty} onChange={e => setNewProductionLog({ ...newProductionLog, productionQty: e.target.value })} className="w-full border rounded p-1.5 text-xs bg-white" placeholder="Qty" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 text-red-500">Waste</label>
                                                                <input type="number" value={newProductionLog.waste} onChange={e => setNewProductionLog({ ...newProductionLog, waste: e.target.value })} className="w-full border rounded p-1.5 text-xs bg-white" placeholder="Qty" />
                                                            </div>
                                                            <button
                                                                onClick={addProductionLog}
                                                                disabled={!newProductionLog.operator || !newProductionLog.productionQty || !phase5Data.allowedWastage}
                                                                className="bg-blue-600 hover:bg-blue-700 text-white rounded p-1.5 text-xs font-bold transition disabled:opacity-50 h-[34px]"
                                                            >
                                                                Add Log Entry
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="mt-4 border rounded p-4 bg-white shadow-sm">
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Phase 5 Comments</label>
                                                <textarea
                                                    value={phase5Data.comments}
                                                    onChange={e => setPhase5Data({ ...phase5Data, comments: e.target.value })}
                                                    disabled={!canEditPhase(5)}
                                                    className="w-full border rounded p-2 text-sm disabled:bg-gray-50 h-20 resize-none"
                                                    placeholder="Add comments for Phase 5..."
                                                />
                                            </div>
                                            {canEditPhase(5) && (
                                                <div className="flex justify-end mt-4 border-t pt-4">
                                                    <button onClick={() => triggerConfirm(5)} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded shadow font-bold text-sm transition disabled:opacity-50">
                                                        {phaseStatuses[5] === 'completed' ? 'Update & Confirm Phase 5' : 'Confirm Phase 5'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        {/* Phase 6 Accordion - QC Check */}
                        <div className="bg-white shadow rounded overflow-hidden">
                            {renderPhaseHeader(6, "QC Check")}
                            {activeTab === 6 && (
                                <div className="p-6 border-t border-gray-200">
                                    {!isPhaseUnlocked(6) ? (
                                        <p className="text-gray-500 italic">This phase is locked. Phase 5 must be completed first.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="border rounded-lg p-4 bg-gray-50/50">
                                                <h3 className="text-sm font-bold text-teal-800 mb-4 flex items-center gap-2">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    Quality Check Logs
                                                </h3>

                                                {/* QC Table */}
                                                <div className="overflow-x-auto mb-4 bg-white rounded border shadow-sm">
                                                    <table className="min-w-full text-[10px] text-left">
                                                        <thead className="bg-gray-100 text-gray-600 font-bold uppercase track-wider">
                                                            <tr>
                                                                <th className="px-2 py-2">UV</th>
                                                                <th className="px-2 py-2">Printing</th>
                                                                <th className="px-2 py-2">Die Cutting</th>
                                                                <th className="px-2 py-2">Lamination</th>
                                                                <th className="px-2 py-2">FG</th>
                                                                <th className="px-2 py-2">Binding</th>
                                                                <th className="px-2 py-2">Packing</th>
                                                                <th className="px-2 py-2">Attachment</th>
                                                                <th className="px-2 py-2 w-8"></th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100">
                                                            {(!phase6Data.qcLogs || phase6Data.qcLogs.length === 0) ? (
                                                                <tr>
                                                                    <td colSpan={9} className="px-3 py-4 text-center text-gray-400 italic">No quality check logs recorded yet.</td>
                                                                </tr>
                                                            ) : (
                                                                phase6Data.qcLogs.map((log: any) => (
                                                                    <tr key={log.id} className="hover:bg-gray-50">
                                                                        <td className="px-2 py-2">{log.uv}</td>
                                                                        <td className="px-2 py-2">{log.printing}</td>
                                                                        <td className="px-2 py-2">{log.dieCutting}</td>
                                                                        <td className="px-2 py-2">{log.lamination}</td>
                                                                        <td className="px-2 py-2 font-semibold text-blue-600">{log.fg}</td>
                                                                        <td className="px-2 py-2">{log.binding}</td>
                                                                        <td className="px-2 py-2">{log.packing}</td>
                                                                        <td className="px-2 py-1">
                                                                            {log.fileUrl ? (
                                                                                <a href={log.fileUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 font-semibold overflow-hidden whitespace-nowrap">
                                                                                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                                                                                    <span className="truncate max-w-[80px]" title={log.fileName || 'View Attachment'}>{log.fileName || 'View'}</span>
                                                                                </a>
                                                                            ) : '-'}
                                                                        </td>
                                                                        <td className="px-2 py-2">
                                                                            {canEditPhase(6) && (
                                                                                <button onClick={() => deleteQCLog(log.id)} className="text-red-400 hover:text-red-600 shrink-0">
                                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                                </button>
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                ))
                                                            )}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                {/* Add QC Log Form */}
                                                {canEditPhase(6) && (
                                                    <div className="flex flex-col gap-3 bg-teal-50/50 p-3 rounded border border-teal-100">
                                                        <div className="grid grid-cols-4 gap-2">
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">UV</label>
                                                                <input type="text" value={newQCLog.uv} onChange={e => setNewQCLog({ ...newQCLog, uv: e.target.value })} className="w-full border rounded p-1 text-xs bg-white" placeholder="Entry" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Printing</label>
                                                                <input type="text" value={newQCLog.printing} onChange={e => setNewQCLog({ ...newQCLog, printing: e.target.value })} className="w-full border rounded p-1 text-xs bg-white" placeholder="Entry" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Die Cutting</label>
                                                                <input type="text" value={newQCLog.dieCutting} onChange={e => setNewQCLog({ ...newQCLog, dieCutting: e.target.value })} className="w-full border rounded p-1 text-xs bg-white" placeholder="Entry" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Lamination</label>
                                                                <input type="text" value={newQCLog.lamination} onChange={e => setNewQCLog({ ...newQCLog, lamination: e.target.value })} className="w-full border rounded p-1 text-xs bg-white" placeholder="Entry" />
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-4 gap-2 items-end">
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">FG</label>
                                                                <input type="text" value={newQCLog.fg} onChange={e => setNewQCLog({ ...newQCLog, fg: e.target.value })} className="w-full border rounded p-1 text-xs bg-white" placeholder="Entry" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Binding</label>
                                                                <input type="text" value={newQCLog.binding} onChange={e => setNewQCLog({ ...newQCLog, binding: e.target.value })} className="w-full border rounded p-1 text-xs bg-white" placeholder="Entry" />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Packing</label>
                                                                <input type="text" value={newQCLog.packing} onChange={e => setNewQCLog({ ...newQCLog, packing: e.target.value })} className="w-full border rounded p-1 text-xs bg-white" placeholder="Entry" />
                                                            </div>
                                                            <div className="flex flex-col">
                                                                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Log Sample (Photo/PDF)</label>
                                                                <div className="flex gap-2 items-center">
                                                                    <label className={`flex items-center justify-center gap-1 px-2 py-1 bg-white border border-dashed rounded text-[10px] font-bold cursor-pointer transition ${fieldLoading.qcSampleUrl ? 'opacity-50 cursor-not-allowed border-blue-400' : 'hover:border-blue-500 hover:bg-blue-50 border-gray-300'}`}>
                                                                        <svg className={`w-3 h-3 ${fieldLoading.qcSampleUrl ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            {fieldLoading.qcSampleUrl ? (
                                                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                                            ) : (
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                                                            )}
                                                                        </svg>
                                                                        {fieldLoading.qcSampleUrl ? 'Uploading...' : newQCLog.fileUrl ? 'Change' : 'Upload'}
                                                                        <input
                                                                            type="file"
                                                                            className="hidden"
                                                                            onChange={(e) => handleFileUpload(e, 'qc_samples', 'fileUrl', setNewQCLog)}
                                                                            disabled={fieldLoading.qcSampleUrl}
                                                                            accept=".pdf,image/png,image/jpeg,image/jpg"
                                                                        />
                                                                    </label>
                                                                    {newQCLog.fileUrl && (
                                                                        <div className="flex items-center gap-1 min-w-0 flex-1">
                                                                            <svg className="w-3 h-3 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                                                            <span className="text-[10px] text-gray-500 truncate" title={newQCLog.fileName}>{newQCLog.fileName}</span>
                                                                            <button onClick={() => setNewQCLog({ ...newQCLog, fileUrl: '', fileName: '' })} className="text-red-500 hover:text-red-700 font-bold text-[10px] ml-auto shrink-0">×</button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={addQCLog}
                                                                className="bg-teal-600 hover:bg-teal-700 text-white rounded p-1 text-xs font-bold transition h-[26px]"
                                                            >
                                                                Add QC Entry
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="mt-4 border rounded p-4 bg-white shadow-sm">
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Phase 6 Comments</label>
                                                <textarea
                                                    value={phase6Data.comments}
                                                    onChange={e => setPhase6Data({ ...phase6Data, comments: e.target.value })}
                                                    disabled={!canEditPhase(6)}
                                                    className="w-full border rounded p-2 text-sm disabled:bg-gray-50 h-20 resize-none"
                                                    placeholder="Add comments for Phase 6..."
                                                />
                                            </div>
                                            {canEditPhase(6) && (
                                                <div className="flex justify-end mt-4 border-t pt-4">
                                                    <button onClick={() => triggerConfirm(6)} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded shadow font-bold text-sm transition disabled:opacity-50">
                                                        {phaseStatuses[6] === 'completed' ? 'Update & Confirm Phase 6' : 'Confirm Phase 6'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Phase 7 Accordion - Delivery Status */}
                        <div className="bg-white shadow rounded overflow-hidden">
                            {renderPhaseHeader(7, "Delivery Status")}
                            {activeTab === 7 && (
                                <div className="p-6 border-t border-gray-200">
                                    {!isPhaseUnlocked(7) ? (
                                        <p className="text-gray-500 italic">This phase is locked. Phase 6 must be completed first.</p>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="border rounded-lg p-4 bg-gray-50/50">
                                                <h3 className="text-sm font-bold text-blue-800 mb-4 flex items-center gap-2">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>
                                                    Delivery Logs
                                                </h3>

                                                <div className="overflow-x-auto mb-4 bg-white rounded border shadow-sm">
                                                    <table className="min-w-full text-xs text-left">
                                                        <thead className="bg-gray-100 text-gray-600 font-bold uppercase tracking-wider">
                                                            <tr>
                                                                <th className="px-3 py-2">FG Received</th>
                                                                <th className="px-3 py-2">Delivery Date</th>
                                                                <th className="px-3 py-2">Challan No.</th>
                                                                <th className="px-3 py-2">Delivered Qty</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100">
                                                            {(!phase7Data.deliveryLogs || phase7Data.deliveryLogs.length === 0) ? (
                                                                <tr>
                                                                    <td colSpan={5} className="px-3 py-4 text-center text-gray-400 italic">No delivery logs recorded yet.</td>
                                                                </tr>
                                                            ) : (
                                                                phase7Data.deliveryLogs.map((log: any) => (
                                                                    <tr key={log.id} className="hover:bg-gray-50">
                                                                        <td className="px-3 py-2">
                                                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${log.fgReceived ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                                                                {log.fgReceived ? 'YES' : 'NO'}
                                                                            </span>
                                                                        </td>
                                                                        <td className="px-3 py-2 italic text-gray-500">{log.deliveryDate || '-'}</td>
                                                                        <td className="px-3 py-2 font-medium">{log.deliveryChallanNo || '-'}</td>
                                                                        <td className="px-3 py-2 font-bold text-blue-600">{log.deliveredQty || '0'}</td>
                                                                    </tr>
                                                                ))
                                                            )}
                                                        </tbody>
                                                    </table>
                                                </div>

                                                <div className="bg-blue-50 border border-blue-200 p-3 rounded flex items-center gap-3 text-blue-700">
                                                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                    <p className="text-xs font-medium">
                                                        This phase is managed automatically via **Delivery Note** creation in the **Finished Goods** tab.
                                                        Logs are added when a DN is linked to this Job Card.
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="border rounded p-4 bg-white shadow-sm">
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Phase 7 Comments</label>
                                                <textarea
                                                    value={phase7Data.comments}
                                                    onChange={e => setPhase7Data({ ...phase7Data, comments: e.target.value })}
                                                    disabled={!canEditPhase(7)}
                                                    className="w-full border rounded p-2 text-sm disabled:bg-gray-50 h-20 resize-none"
                                                    placeholder="Add comments for Phase 7..."
                                                />
                                            </div>
                                            {canEditPhase(7) && (
                                                <div className="flex justify-end mt-4 border-t pt-4">
                                                    <button onClick={() => triggerConfirm(7)} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded shadow font-bold text-sm transition disabled:opacity-50">
                                                        {phaseStatuses[7] === 'completed' ? 'Update & Confirm Phase 7' : 'Confirm Phase 7'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Phase 8 Accordion - Closure */}
                            <div className="bg-white shadow rounded overflow-hidden">
                                {renderPhaseHeader(8, "Closure")}
                                {activeTab === 8 && (
                                    <div className="p-6 border-t border-gray-200">
                                        {!isPhaseUnlocked(8) ? (
                                            <p className="text-gray-500 italic">This phase is locked. Phase 7 must be completed first.</p>
                                        ) : (
                                            <div className="space-y-4">
                                                {(() => {
                                                    const totalActualWastage = (phase5Data.productionLogs || []).reduce((sum: number, log: any) => sum + Number(log.waste || 0), 0);
                                                    const allowedWastage = Number(phase5Data.allowedWastage || 0);
                                                    const excessWastage = Math.max(0, totalActualWastage - allowedWastage);
                                                    const excessWastagePercent = allowedWastage > 0 ? ((excessWastage / allowedWastage) * 100).toFixed(2) : '0.00';

                                                    return (
                                                        <>
                                                            <div className="grid grid-cols-3 gap-4">
                                                                <div className="bg-blue-50 p-3 rounded border border-blue-100">
                                                                    <label className="block text-xs font-bold text-blue-700 mb-1">Allowed Wastage (Qty)</label>
                                                                    <div className="text-lg font-bold">{allowedWastage}</div>
                                                                </div>
                                                                <div className="bg-green-50 p-3 rounded border border-green-100">
                                                                    <label className="block text-xs font-bold text-green-700 mb-1">Actual Wastage (Qty)</label>
                                                                    <div className="text-lg font-bold">{totalActualWastage}</div>
                                                                </div>
                                                                <div className={`${excessWastage > 0 ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-200'} p-3 rounded border`}>
                                                                    <label className={`block text-xs font-bold ${excessWastage > 0 ? 'text-red-700' : 'text-gray-700'} mb-1`}>Excess Wastage (%)</label>
                                                                    <div className={`text-lg font-bold ${excessWastage > 0 ? 'text-red-800' : 'text-gray-800'}`}>{excessWastagePercent}%</div>
                                                                </div>
                                                            </div>

                                                            <div className="space-y-4 mt-4">
                                                                {excessWastage > 0 && (
                                                                    <div className="col-span-2">
                                                                        <label className="block text-xs font-bold text-red-700 mb-1">Root Cause (Compulsory for Excess Wastage)</label>
                                                                        <textarea
                                                                            value={phase8Data.rootCause}
                                                                            onChange={e => setPhase8Data({ ...phase8Data, rootCause: e.target.value })}
                                                                            disabled={!canEditPhase(8)}
                                                                            className="w-full border border-red-200 rounded p-2 text-sm focus:ring-red-200"
                                                                            rows={2}
                                                                            placeholder="Please enter the root cause for excess wastage..."
                                                                        ></textarea>
                                                                    </div>
                                                                )}
                                                                <div className="col-span-2">
                                                                    <label className="block text-xs font-bold text-gray-700 mb-1">CAPA (Corrective Action)</label>
                                                                    <textarea value={phase8Data.capa} onChange={e => setPhase8Data({ ...phase8Data, capa: e.target.value })} disabled={!canEditPhase(8)} className="w-full border rounded p-2 text-sm disabled:bg-gray-50" rows={2}></textarea>
                                                                </div>
                                                            </div>
                                                        </>
                                                    );
                                                })()}
                                                <div className="mt-4 border-t pt-4">
                                                    <h5 className="font-bold text-sm text-gray-700 mb-2">Signatures (Digital Check-off)</h5>
                                                    <div className="flex gap-6">
                                                        <label className="flex items-center gap-2">
                                                            <input type="checkbox" checked={phase8Data.prodSignature} onChange={e => setPhase8Data({ ...phase8Data, prodSignature: e.target.checked })} disabled={!canEditPhase(8)} className="w-4 h-4 text-blue-600" />
                                                            <span className="text-sm font-medium">Production Signed</span>
                                                        </label>
                                                        <label className="flex items-center gap-2">
                                                            <input type="checkbox" checked={phase8Data.qcSignature} onChange={e => setPhase8Data({ ...phase8Data, qcSignature: e.target.checked })} disabled={!canEditPhase(8)} className="w-4 h-4 text-blue-600" />
                                                            <span className="text-sm font-medium">QC Signed</span>
                                                        </label>
                                                        <label className="flex items-center gap-2">
                                                            <input type="checkbox" checked={phase8Data.headSignature} onChange={e => setPhase8Data({ ...phase8Data, headSignature: e.target.checked })} disabled={!canEditPhase(8)} className="w-4 h-4 text-blue-600" />
                                                            <span className="text-sm font-medium">Head Signed</span>
                                                        </label>
                                                    </div>
                                                    <div className="mt-4">
                                                        <label className="block text-xs font-bold text-gray-700 mb-1">Phase 8 Comments</label>
                                                        <textarea
                                                            value={phase8Data.comments}
                                                            onChange={e => setPhase8Data({ ...phase8Data, comments: e.target.value })}
                                                            disabled={!canEditPhase(8)}
                                                            className="w-full border rounded p-2 text-sm disabled:bg-gray-50 h-20 resize-none"
                                                            placeholder="Add comments for Phase 8..."
                                                        />
                                                    </div>
                                                </div>
                                                {canEditPhase(8) && (
                                                    <div className="flex justify-end mt-4 border-t pt-4">
                                                        <button onClick={() => triggerConfirm(8)} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded shadow font-bold text-sm transition disabled:opacity-50">
                                                            {phaseStatuses[8] === 'completed' ? 'Update & Confirm Closure' : 'Confirm Phase 8 (Closure)'}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <ConfirmationModal
                    isOpen={isConfirmModalOpen}
                    title={`Confirm Phase ${phaseToConfirm}`}
                    message={
                        phaseToConfirm === 8
                            ? "Are you sure you want to confirm Closure? This will complete the Job Card."
                            : `Are you sure you want to confirm Phase ${phaseToConfirm}? This will mark it as completed and notify the relevant personnel for Phase ${phaseToConfirm! + 1}.`
                    }
                    onConfirm={() => {
                        if (phaseToConfirm !== null) {
                            handleConfirmPhase(phaseToConfirm)
                        }
                        setIsConfirmModalOpen(false)
                    }}
                    onCancel={() => setIsConfirmModalOpen(false)}
                />
                <ConfirmationModal
                    isOpen={isDeleteModalOpen}
                    title="Delete Job Card"
                    message={`Are you sure you want to delete Job Card ${jobCardNo}? This action is permanent and cannot be undone.`}
                    onConfirm={handleDeleteJobCard}
                    onCancel={() => setIsDeleteModalOpen(false)}
                    confirmText={loading ? "Deleting..." : "Delete Permanently"}
                    isDangerous={true}
                />

                {/* No Data Found Modal */}
                <ConfirmationModal
                    isOpen={isNoDataModalOpen}
                    title="No Previous Data Found"
                    message={`No previous data found for the selected job "${noDataJobName}". Starting with a blank form.`}
                    onConfirm={() => setIsNoDataModalOpen(false)}
                    onCancel={() => setIsNoDataModalOpen(false)} // Need to provide onCancel even if hidden
                    confirmText="OK"
                    hideCancel={true}
                    isDangerous={false}
                />

                {/* Marketing Manager Approval Modal */}
                <ConfirmationModal
                    isOpen={isMarketingApprovalModalOpen}
                    title="Approve Phase 1"
                    message={`Are you sure you want to approve Phase 1 for Job Card ${jobCardNo}? This will unlock Phase 2 for the Pre-Press team.`}
                    onConfirm={handleMarketingManagerApproval}
                    onCancel={() => setIsMarketingApprovalModalOpen(false)}
                    confirmText={loading ? "Approving..." : "Approve Phase 1"}
                    isDangerous={false}
                />
            </div>
        </div>
    );
};
