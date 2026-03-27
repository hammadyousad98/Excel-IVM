const Database = require('better-sqlite3');
const { join } = require('path');
const { app } = require('electron');

try {
    const dbPath = 'C:\\Users\\DELL\\AppData\\Roaming\\inventory-management-system\\inventory.db';
    const db = new Database(dbPath, { verbose: console.log });

    console.log('Table Info for inventory_transactions:');
    const tableInfo = db.prepare("PRAGMA table_info(inventory_transactions)").all();
    console.log(tableInfo);

    console.log('Inventory Sheets:');
    const sheets = db.prepare("SELECT * FROM inventory_sheets").all();
    console.log(sheets);

} catch (err) {
    console.error('Verification failed:', err);
}
