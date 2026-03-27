import React, { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { Login } from './components/Login'
import { Inventory } from './components/Inventory'
import { PurchaseOrders } from './components/PurchaseOrders'
import { POCreate } from './components/POCreate'
import { Dashboard } from './components/Dashboard'
import { TransactionHistory } from './components/TransactionHistory'
import { SupplierManager } from './components/SupplierManager'
import { ProductManager } from './components/ProductManager'
import logo from './assets/ExcelLogo.png'

import { UpdateNotification } from './components/UpdateNotification'
import { SalesOrders } from './components/SalesOrders'
import { Production } from './components/Production'
import { JobCardsList } from './components/JobCards/JobCardsList'
import { JobCardViewer } from './components/JobCards/JobCardViewer'
import { JobCardsDashboard } from './components/JobCards/JobCardsDashboard'
import { NotificationBell } from './components/JobCards/NotificationBell'

const MainApp: React.FC = () => {
    const { isAuthenticated, logout, user } = useAuth()
    const [view, setView] = useState<'dashboard' | 'inventory' | 'sales-orders' | 'production' | 'pos' | 'po-create' | 'po-edit' | 'transactions' | 'suppliers' | 'products' | 'job-cards-dashboard' | 'job-cards-sheet' | 'job-cards-view'>('dashboard')
    const [activeSection, setActiveSection] = useState<'raw_material' | 'finished_goods' | 'job_cards'>('raw_material')
    const [editingPO, setEditingPO] = useState<any>(null)
    const [deepLink, setDeepLink] = useState<{ jobCardId: string, phase: number, jobNum?: string } | null>(null)

    const handleNotificationClick = (jobCardId: string, phase: number, jobNum?: string) => {
        console.log("[App] handleNotificationClick triggered for Job:", jobCardId, "Num:", jobNum, "Phase:", phase);
        setDeepLink({ jobCardId, phase, jobNum })
        setActiveSection('job_cards')
        setView('job-cards-sheet')
    }

    // Role helpers
    const isAdmin = user?.role === 'admin'
    const isPoOfficer = user?.role === 'po_officer'
    const isDeliveryOfficer = user?.role === 'delivery_officer'
    const isMarketing = user?.role === 'marketing'
    const isMarketingManager = user?.role === 'marketing_manager'
    const isProductionOfficer = user?.role === 'production'
    // Restricted roles — locked to FG, specific page only
    const isRestrictedFgRole = isDeliveryOfficer || isMarketing || isMarketingManager || isProductionOfficer

    React.useEffect(() => {
        if (window.electron && window.electron.ipcRenderer) {
            const removeListener = window.electron.ipcRenderer.on('open-job-card', (_event, data: { jobCardId: string, targetPhase: number }) => {
                console.log("[App] Received open-job-card IPC:", data);
                handleNotificationClick(data.jobCardId, data.targetPhase || 1);
            });
            return () => {
                if (typeof removeListener === 'function') {
                    removeListener();
                } else {
                    window.electron.ipcRenderer.removeAllListeners('open-job-card');
                }
            };
        }
        return undefined;
    }, []);

    React.useEffect(() => {
        if (user) {
            if (isDeliveryOfficer) {
                setActiveSection('finished_goods')
                setView('pos')
            } else if (isMarketing || isMarketingManager) {
                setActiveSection('finished_goods')
                setView('sales-orders')
            } else if (isProductionOfficer) {
                setActiveSection('finished_goods')
                setView('production')
            } else if (isPoOfficer) {
                setActiveSection('raw_material')
                setView('pos')
            } else if (user?.role === 'pre_press' || user?.role === 'qc') {
                setActiveSection('job_cards')
                setView('job-cards-sheet')
            } else {
                setActiveSection('raw_material')
                setView('dashboard')
            }
        }
    }, [user])

    if (!isAuthenticated) {
        return (
            <>
                <Login />
                <UpdateNotification />
            </>
        )
    }

    const handleEditPO = (po: any) => {
        setEditingPO(po)
        setView('po-edit')
    }

    const isFinishedGoods = activeSection === 'finished_goods'

    // Role display name
    const roleLabels: Record<string, string> = {
        admin: 'Admin',
        marketing: 'Marketing',
        marketing_manager: 'Marketing Manager',
        pre_press: 'Prepress',
        po_officer: 'Purchase Officer',
        production: 'Production',
        qc: 'QC',
        delivery_officer: 'Delivery Officer',
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <UpdateNotification />
            <nav className="bg-white shadow-sm">
                <div className="w-full mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center gap-3">
                                <img src={logo} alt="Logo" className="h-8 w-8 object-contain" />
                                <h1 className="text-xl font-bold text-gray-900">Inventory System</h1>
                            </div>

                            {/* Section Tabs */}
                            <div className="flex bg-gray-100 rounded p-1 ml-4 gap-1">
                                {!isRestrictedFgRole && (
                                    <button
                                        onClick={() => { setActiveSection('raw_material'); setView(isPoOfficer ? 'pos' : 'dashboard'); }}
                                        className={`px-3 py-1 rounded text-sm font-medium ${activeSection === 'raw_material' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                                    >
                                        Raw Material
                                    </button>
                                )}
                                {!isPoOfficer && (
                                    <button
                                        onClick={() => { setActiveSection('finished_goods'); setView(isDeliveryOfficer ? 'pos' : (isMarketing || isMarketingManager) ? 'sales-orders' : isProductionOfficer ? 'production' : 'dashboard'); }}
                                        className={`px-3 py-1 rounded text-sm font-medium ${activeSection === 'finished_goods' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                                    >
                                        Finished Goods
                                    </button>
                                )}
                                <button
                                    onClick={() => { setActiveSection('job_cards'); setView('job-cards-sheet'); }}
                                    className={`px-3 py-1 rounded text-sm font-medium ${activeSection === 'job_cards' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}
                                >
                                    Job Cards
                                </button>
                            </div>

                            <div className="h-6 w-px bg-gray-300 mx-2"></div>

                            {activeSection !== 'job_cards' ? (
                                <>
                                    {/* Dashboard — visible to all */}
                                    <button onClick={() => setView('dashboard')} className={`px-3 py-2 rounded ${view === 'dashboard' ? 'bg-gray-200' : ''}`}>Dashboard</button>

                                    {/* Inventory Sheet — visible for restricted FG roles (read-only), hidden for others if they toggled RM */}
                                    {(!isRestrictedFgRole || true) && (
                                        <button onClick={() => setView('inventory')} className={`px-3 py-2 rounded ${view === 'inventory' ? 'bg-gray-200' : ''}`}>
                                            Inventory
                                        </button>
                                    )}

                                    {/* Sales Orders — FG only. Always visible for marketing roles, visible for admin in FG */}
                                    {((isMarketing || isMarketingManager) || (isFinishedGoods && (isAdmin || isDeliveryOfficer || isProductionOfficer))) && (
                                        <button onClick={() => setView('sales-orders')} className={`px-3 py-2 rounded ${view === 'sales-orders' ? 'bg-gray-200' : ''}`}>
                                            Sales Orders
                                        </button>
                                    )}

                                    {/* Production — FG only. Always visible for production_officer, visible for admin in FG */}
                                    {(isProductionOfficer || (isFinishedGoods && (isAdmin || isDeliveryOfficer || isMarketing || isMarketingManager))) && (
                                        <button onClick={() => setView('production')} className={`px-3 py-2 rounded ${view === 'production' ? 'bg-gray-200' : ''}`}>
                                            Production
                                        </button>
                                    )}

                                    {/* Purchase/Delivery Orders — visible to all */}
                                    {(!isRestrictedFgRole || isDeliveryOfficer) && (
                                        <button onClick={() => setView('pos')} className={`px-3 py-2 rounded ${view === 'pos' ? 'bg-gray-200' : ''}`}>
                                            {isFinishedGoods ? 'Delivery Orders' : 'Purchase Orders'}
                                        </button>
                                    )}

                                    {/* Products — visible to all */}
                                    <button onClick={() => setView('products')} className={`px-3 py-2 rounded ${view === 'products' ? 'bg-gray-200' : ''}`}>Products</button>

                                    {/* Suppliers/Buyers — hidden for restricted FG roles (except buyers/customers in FG) */}
                                    {(!isRestrictedFgRole || isFinishedGoods) && (
                                        <button onClick={() => setView('suppliers')} className={`px-3 py-2 rounded ${view === 'suppliers' ? 'bg-gray-200' : ''}`}>{isFinishedGoods ? 'Buyers' : 'Suppliers'}</button>
                                    )}
                                </>
                            ) : (
                                <>
                                    {/* Job Cards Sub-Navigation */}
                                    <button onClick={() => setView('job-cards-dashboard')} className={`px-3 py-2 rounded ${view === 'job-cards-dashboard' ? 'bg-gray-200' : ''}`}>Dashboard</button>
                                    <button onClick={() => setView('job-cards-sheet')} className={`px-3 py-2 rounded ${view === 'job-cards-sheet' ? 'bg-gray-200' : ''}`}>Sheet</button>
                                    <button onClick={() => setView('job-cards-view')} className={`px-3 py-2 rounded ${view === 'job-cards-view' ? 'bg-gray-200' : ''}`}>Job Card Viewer</button>
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-4">
                            <NotificationBell onNotificationClick={handleNotificationClick} />
                            <div className="h-6 w-px bg-gray-300"></div>
                            <span className="text-gray-700">Welcome, {user?.username} ({roleLabels[user?.role || ''] || user?.role})</span>
                            <button
                                onClick={logout}
                                className="px-3 py-2 text-sm font-medium text-red-600 hover:text-red-800"
                            >
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            </nav>
            <main className="w-full mx-auto py-6 sm:px-6 lg:px-8">
                <div className="px-4 py-6 sm:px-0">
                    {view === 'dashboard' && activeSection !== 'job_cards' && <Dashboard section={isRestrictedFgRole ? 'finished_goods' : activeSection} />}
                    {view === 'inventory' && activeSection !== 'job_cards' && <Inventory section={activeSection} />}
                    {view === 'sales-orders' && activeSection !== 'job_cards' && <SalesOrders />}
                    {view === 'production' && activeSection !== 'job_cards' && <Production />}
                    {view === 'transactions' && activeSection !== 'job_cards' && <TransactionHistory />}
                    {view === 'suppliers' && activeSection !== 'job_cards' && <SupplierManager section={activeSection} />}
                    {view === 'products' && activeSection !== 'job_cards' && <ProductManager section={isRestrictedFgRole ? 'finished_goods' : activeSection} />}

                    {/* Job Cards Views */}
                    {view === 'job-cards-dashboard' && <JobCardsDashboard />}
                    {view === 'job-cards-sheet' && (
                        <JobCardsList
                            deepLink={deepLink}
                            onDeepLinkHandled={() => setDeepLink(null)}
                        />
                    )}
                    {view === 'job-cards-view' && <JobCardViewer />}

                    {view === 'pos' && activeSection !== 'job_cards' && (
                        <div>
                            <div className="mb-4 flex justify-end">
                                {(isAdmin ||
                                    (activeSection === 'raw_material' && isPoOfficer) ||
                                    (isFinishedGoods && isDeliveryOfficer)) && (
                                        <button onClick={() => setView('po-create')} className="bg-green-500 text-white px-4 py-2 rounded">
                                            {isFinishedGoods ? 'New Delivery Order' : 'New Purchase Order'}
                                        </button>
                                    )}
                            </div>
                            <PurchaseOrders onEdit={handleEditPO} section={isRestrictedFgRole ? 'finished_goods' : activeSection} />
                        </div>
                    )}
                    {view === 'po-create' && activeSection !== 'job_cards' && (
                        <POCreate onCancel={() => setView('pos')} onSuccess={() => setView('pos')} section={isRestrictedFgRole ? 'finished_goods' : activeSection} />
                    )}
                    {view === 'po-edit' && activeSection !== 'job_cards' && (
                        <POCreate initialData={editingPO} onCancel={() => setView('pos')} onSuccess={() => setView('pos')} section={isRestrictedFgRole ? 'finished_goods' : activeSection} />
                    )}
                </div>
            </main>
        </div>
    )
}

function App(): JSX.Element {
    return (
        <AuthProvider>
            <MainApp />
        </AuthProvider>
    )
}

export default App
