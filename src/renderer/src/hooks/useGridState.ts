import { useEffect, useRef } from 'react'

export const useGridState = (gridId: string, api: any) => {
    // Add prefix to ensure unique keys in storage
    const storageKey = `ag-grid-state-${gridId}`;
    const isRestoring = useRef(false);
    const isReady = useRef(false);

    // RESTORE STATE on ID/API change
    useEffect(() => {
        isReady.current = false; // Reset ready state on new API/ID
        if (!api) return;

        const restoreState = () => {
            try {
                const savedState = sessionStorage.getItem(storageKey);
                if (savedState) {
                    const state = JSON.parse(savedState);
                    isRestoring.current = true;

                    if (state.filter) api.setFilterModel(state.filter);
                    if (state.colState) api.applyColumnState({ state: state.colState, applyOrder: true });

                    // Allow saving after restoration is done
                    setTimeout(() => {
                        isRestoring.current = false;
                        isReady.current = true;
                    }, 500);
                } else {
                    // No state to restore, just mark as ready
                    isReady.current = true;
                }
            } catch (e) {
                console.error("Failed to restore grid state", e);
                isReady.current = true;
            }
        }

        // Delay restore slightly to ensure grid is ready
        setTimeout(restoreState, 100);

    }, [api, gridId]);

    // SAVE STATE event handler
    const onGridStateChanged = () => {
        // Block saves if not ready or currently restoring
        if (!api || isRestoring.current || !isReady.current) return;

        try {
            const state = {
                filter: api.getFilterModel(),
                colState: api.getColumnState()
            };
            sessionStorage.setItem(storageKey, JSON.stringify(state));
        } catch (e) {
            console.error("Failed to save grid state", e);
        }
    };

    return {
        // Return props to spread onto AgGridReact
        onFilterChanged: onGridStateChanged,
        onSortChanged: onGridStateChanged,
        onColumnVisible: onGridStateChanged,
        onColumnPinned: onGridStateChanged,
        onColumnResized: onGridStateChanged,
        onColumnMoved: onGridStateChanged,
        onColumnRowGroupChanged: onGridStateChanged
    }
}
