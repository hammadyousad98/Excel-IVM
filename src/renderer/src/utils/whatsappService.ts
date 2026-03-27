/**
 * WhatsApp Service
 * Handles sending WhatsApp messages by communicating with the main process.
 */

export const whatsappService = {
    /**
     * Sends a WhatsApp message to a specific number.
     * @param phoneNumber The phone number (with country code, no +)
     * @param message The message text
     */
    async sendMessage(phoneNumber: string, message: string): Promise<boolean> {
        if (!phoneNumber) return false;

        try {
            // Clean phone number (remove any non-digits)
            const cleanNumber = phoneNumber.replace(/\D/g, '');

            // Send via IPC to the main process
            // We use IPC so the main process can handle opening the browser/API call
            // and avoid CORS issues if we were to call a WhatsApp API directly.
            const result = await window.electron.ipcRenderer.invoke('send-whatsapp', {
                phoneNumber: cleanNumber,
                message: message
            });

            return result;
        } catch (error) {
            console.error('Error in whatsappService.sendMessage:', error);
            return false;
        }
    },

    /**
     * Formats a Job Card notification message for WhatsApp.
     */
    formatJobCardMessage(jobNum: string, phaseNum: number, isReconfirm: boolean = false): string {
        if (isReconfirm) {
            return `*Job Card Update: ${jobNum}*\n\nPhase ${phaseNum - 1} was updated. Phase ${phaseNum} requires your re-confirmation.\n\nPlease check the system for details.`;
        }
        return `*Job Card Update: ${jobNum}*\n\nPhase ${phaseNum - 1} is complete. Phase ${phaseNum} is now ready for your action.\n\nPlease check the system for details.`;
    }
};
