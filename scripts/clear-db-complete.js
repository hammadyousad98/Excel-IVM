const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

// We need to hardcode the path or get it from app.getPath if we were a real app, 
// but here we are a script. 
// The user's DB is at: C:\Users\DELL\AppData\Roaming\inventory-management-system\inventory.db
const dbPath = 'C:\\Users\\DELL\\AppData\\Roaming\\inventory-management-system\\inventory.db';

console.log('Opening database at:', dbPath);
const db = new Database(dbPath, { verbose: console.log });

try {
    console.log('Starting COMPLETE database clear...');

    db.exec('PRAGMA foreign_keys = OFF');

    db.transaction(() => {
        const tables = [
            'inventory_transactions',
            'po_line_items',
            'purchase_orders',
            'inventory_sheets',
            'products',
            'suppliers',
            'categories'
        ];

        for (const table of tables) {
            console.log(`Deleting from ${table}...`);
            db.prepare(`DELETE FROM ${table}`).run();
        }

        console.log('Users table preserved.');
    })();

    db.exec('PRAGMA foreign_keys = ON');
    console.log('Database cleared successfully.');

    // We must exit explicitly because Electron might keep running
    process.exit(0);

} catch (error) {
    console.error('Failed to clear database:', error);
    process.exit(1);
}
