import { Notification, BrowserWindow } from 'electron'

export function showSystemNotification(title: string, body: string, jobCardId?: string, targetPhase?: number) {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    console.log(`[Main Notifications] Showing system notification: ${title}`);
    const notification = new Notification({
        title,
        body,
        silent: false,
    });

    notification.on('click', () => {
        console.log(`[Main Notifications] Notification clicked: ${jobCardId}`);
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            if (jobCardId) {
                mainWindow.webContents.send('open-job-card', { jobCardId, targetPhase });
            }
        }
    });

    notification.show();
}

// These are now stubs to prevent breaking IPC imports, 
// though they are no longer strictly functional for Firestore.
export function setUserRole(_role: string) { }
export function clearUserRole() { }
