import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import url from 'url'
import { setUserRole, clearUserRole, showSystemNotification } from './notification-service'

// Register all IPC handlers for the application
export function registerIpcHandlers(): void {
    const safeHandle = (channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) => {
        ipcMain.handle(channel, async (event, ...args) => {
            const label = `[IPC] ${channel}`
            console.time(label) // Start timer
            try {
                const result = await handler(event, ...args)
                console.timeEnd(label) // End timer and log duration
                return result
            } catch (error) {
                console.timeEnd(label)
                console.error(`[IPC ERROR] ${channel}:`, error)
                throw error
            }
        })
    }

    // --- LEGACY DATABASE HANDLERS REMOVED ---
    // The application has migrated to Firebase.
    // Local SQLite headers have been removed.

    // Test
    safeHandle('ping', () => 'pong')

    // Logging
    ipcMain.on('log-to-terminal', (_, message) => {
        console.log('[Renderer Log]', message)
    })

    // Native Dialogs
    safeHandle('show-confirm-dialog', async (event, { title, message, type = 'info', buttons = ['Cancel', 'OK'] }) => {
        // THE FIX: Get the actual window that sent this request
        const win = BrowserWindow.fromWebContents(event.sender);

        const result = await dialog.showMessageBox(win!, { // Passing 'win' parents the dialog
            type: type,
            title: title,
            message: message,
            buttons: buttons,
            defaultId: 1,
            cancelId: 0,
            noLink: true,
            normalizeAccessKeys: true
        })

        // THE FIX: Explicitly force focus back to the inputs
        if (win) {
            win.focus();
            win.webContents.focus();
        }

        return result.response === 1
    })

    // Native PDF Printing via Hidden Window
    safeHandle('print-pdf', async (event, dataUri: string) => {
        return new Promise((resolve, reject) => {
            // Extract base64 payload from data URI
            const matches = dataUri.match(/^data:application\/pdf.*?;base64,(.*)$/)
            if (!matches || !matches[1]) {
                const err = new Error('Invalid PDF data URI');
                console.error('[IPC ERROR] print-pdf:', err);
                return reject(err)
            }

            const pdfBuffer = Buffer.from(matches[1], 'base64')
            const tempPath = path.join(os.tmpdir(), `print_${Date.now()}.pdf`)
            const tempHtmlPath = path.join(os.tmpdir(), `print_wrapper_${Date.now()}.html`)

            try {
                fs.writeFileSync(tempPath, pdfBuffer)
                console.log(`[IPC] PDF temp file created: ${tempPath} (${pdfBuffer.length} bytes)`)

                // Create an HTML wrapper. This is sometimes more reliable for triggering the PDF plugin rendering.
                const fileUrl = url.pathToFileURL(tempPath).href
                const htmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <style>
                            body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; background: white; }
                            embed { width: 100vw; height: 100vh; }
                        </style>
                    </head>
                    <body>
                        <embed src="${fileUrl}" type="application/pdf"></embed>
                    </body>
                    </html>
                `
                fs.writeFileSync(tempHtmlPath, htmlContent)
            } catch (err) {
                console.error('[IPC ERROR] Failed to write temp files:', err)
                return reject(err)
            }

            let printWindow: BrowserWindow | null = new BrowserWindow({
                show: true,
                x: -3000,
                y: -3000,
                width: 1200,
                height: 800,
                focusable: true,
                webPreferences: {
                    plugins: true,
                    sandbox: false,
                    contextIsolation: true
                }
            })

            const htmlUrl = url.pathToFileURL(tempHtmlPath).href
            console.log('[IPC] Loading PDF Wrapper:', htmlUrl)
            printWindow.loadURL(htmlUrl)

            printWindow.webContents.on('did-finish-load', () => {
                // Wait for the plugin to stabilize
                setTimeout(async () => {
                    if (!printWindow) return;

                    // Diagnostic: Capture a tiny piece of the page to see if it's rendering
                    try {
                        const image = await printWindow.webContents.capturePage({ x: 0, y: 0, width: 100, height: 100 })
                        if (image.isEmpty()) {
                            console.warn('[IPC WARNING] capturePage returned empty image - window might be blank')
                        } else {
                            console.log('[IPC] capturePage successful - window appears to have content')
                        }
                    } catch (e) {
                        console.error('[IPC ERROR] Diagnostic capture failed:', e)
                    }

                    printWindow.focus()
                    printWindow.webContents.focus()

                    printWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
                        if (!success) {
                            console.error('[IPC ERROR] Print failed:', failureReason)
                        }
                        resolve(success)

                        // Cleanup
                        printWindow?.close()
                        printWindow = null
                        try {
                            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
                            if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath)
                        } catch (e) { }
                    })
                }, 4000)
            })

            printWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
                console.error('[IPC ERROR] Failed to load PDF wrapper:', errorDescription)
                reject(new Error(errorDescription))
                printWindow?.close()
                printWindow = null
                try {
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
                    if (fs.existsSync(tempHtmlPath)) fs.unlinkSync(tempHtmlPath)
                } catch (err) { }
            })
        })
    })

    // WhatsApp Notification Support
    safeHandle('send-whatsapp', async (_event, { phoneNumber, message }) => {
        try {
            console.log(`[WhatsApp] Sending to ${phoneNumber}: ${message}`);

            // For now, we use the free wa.me api to trigger a message.
            // This will open the user's default browser or WhatsApp app.
            // In a full production system, this could be replaced with a silent API call (e.g. Twilio)
            const encodedMessage = encodeURIComponent(message);
            const url = `https://wa.me/${phoneNumber}?text=${encodedMessage}`;

            await shell.openExternal(url);
            return true;
        } catch (error) {
            console.error('[WhatsApp Error]', error);
            return false;
        }
    })

    // User Role Synchronization for Notifications
    ipcMain.on('set-user-role', (_event, role: string) => {
        setUserRole(role)
    })

    ipcMain.on('clear-user-role', () => {
        clearUserRole()
    })

    ipcMain.on('show-notification', (_event, { title, body, jobCardId, targetPhase }) => {
        showSystemNotification(title, body, jobCardId, targetPhase)
    })

    // Cloudinary Secure Signed Upload (Main Process)
    safeHandle('upload-to-cloudinary', async (_event, { filePath, folder }) => {
        const cloudName = "dwbhfwfne";
        const apiKey = "839159796393743";
        const apiSecret = "4zl-nPkutou_Nwr3NQ0Hx3W9SnY";
        
        console.log(`[Main] Starting secure Cloudinary upload for: ${path.basename(filePath)}`);
        
        try {
            const timestamp = Math.round(new Date().getTime() / 1000);
            const fileBuffer = fs.readFileSync(filePath);
            
            // To do a signed upload, we need to sign specific parameters
            // These must be in alphabetical order for the signature
            const paramsToSign: any = {
                folder: folder,
                timestamp: timestamp
            };

            const signatureString = Object.keys(paramsToSign)
                .sort()
                .map(key => `${key}=${paramsToSign[key]}`)
                .join('&') + apiSecret;

            const crypto = require('crypto');
            const signature = crypto.createHash('sha1').update(signatureString).digest('hex');

            const formData = new FormData();
            formData.append('file', new Blob([fileBuffer])); // Upload as binary blob
            formData.append('api_key', apiKey);
            formData.append('timestamp', timestamp.toString());
            formData.append('signature', signature);
            formData.append('folder', folder);

            const url = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
            
            const response = await fetch(url, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[Main] Cloudinary error: ${errText}`);
                throw new Error(`Cloudinary rejected: ${errText}`);
            }

            const data = await response.json();
            console.log(`[Main] Cloudinary Success: ${data.secure_url}`);
            return data;

        } catch (error: any) {
            console.error(`[Main] Upload failed: ${error.message}`);
            throw error;
        }
    })
}
