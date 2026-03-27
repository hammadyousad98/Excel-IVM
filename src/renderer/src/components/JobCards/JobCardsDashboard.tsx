import React from 'react'

export const JobCardsDashboard: React.FC = () => {
    return (
        <div className="flex h-[calc(100vh-100px)] bg-gray-100 overflow-hidden text-gray-800 relative">
            <div className="flex-1 flex flex-col min-w-0 bg-white">
                <div className="flex justify-between items-center p-4 border-b">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">Job Cards Dashboard</h1>
                    </div>
                </div>
                <div className="flex-1 p-4 flex flex-col items-center justify-center text-gray-400">
                    <p className="text-lg">Dashboard Visualizations Coming Soon</p>
                </div>
            </div>
        </div>
    )
}
