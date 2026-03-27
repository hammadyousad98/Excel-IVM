import React, { useEffect, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { GridApi } from 'ag-grid-community'
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import { useGridState } from '../hooks/useGridState'

export const TransactionHistory: React.FC = () => {
    const [transactions, setTransactions] = useState<any[]>([])
    const [gridApi, setGridApi] = useState<GridApi | null>(null)
    const gridStateHandlers = useGridState('transaction-history', gridApi)

    useEffect(() => {
        const fetchTransactions = async () => {
            try {
                const data = await window.electron.ipcRenderer.invoke('get-transactions')
                setTransactions(data)
            } catch (error) {
                console.error('Failed to fetch transactions', error)
            }
        }
        fetchTransactions()
    }, [])

    const columnDefs = [
        { field: 'id', headerName: 'ID', width: 70 },
        { field: 'date', headerName: 'Date' },
        { field: 'type', headerName: 'Type' },
        { field: 'product_name', headerName: 'Product' },
        { field: 'quantity', headerName: 'Qty' },
        { field: 'rate', headerName: 'Rate' },
        { field: 'total_amount', headerName: 'Total' },
        { field: 'po_number', headerName: 'PO #' }
    ]

    return (
        <div className="p-4">
            <h2 className="text-2xl font-bold mb-4">Transaction History</h2>
            <div className="ag-theme-alpine" style={{ height: 500, width: '100%' }}>
                <AgGridReact
                    enableCellTextSelection={true}
                    rowData={transactions}
                    columnDefs={columnDefs}
                    defaultColDef={{ sortable: true, filter: true, resizable: true }}
                    onGridReady={(params) => setGridApi(params.api)}
                    {...gridStateHandlers}
                />
            </div>
        </div>
    )
}
