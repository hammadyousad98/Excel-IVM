import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/index.css'
import { ModuleRegistry, ClientSideRowModelModule } from 'ag-grid-community'

// Register Ag-Grid Modules (Required for v31+)
ModuleRegistry.registerModules([ClientSideRowModelModule])

// Ag-Grid Styles
import 'ag-grid-community/styles/ag-grid.css'
import 'ag-grid-community/styles/ag-theme-alpine.css'
import 'ag-grid-community/styles/ag-theme-quartz.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <App />
)
