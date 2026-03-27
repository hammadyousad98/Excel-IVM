const Database = require('better-sqlite3');
const path = require('path');

const dbPath = 'C:\\Users\\DELL\\AppData\\Roaming\\inventory-management-system\\inventory.db';
const db = new Database(dbPath, { verbose: console.log });

try {
    console.log('Starting database clear...');

    // Disable foreign keys to allow deletion in any order (or just delete in order)
    db.exec('PRAGMA foreign_keys = OFF');

    db.transaction(() => {
        console.log('Deleting inventory_transactions...');
        db.prepare('DELETE FROM inventory_transactions').run();

        console.log('Deleting po_line_items...');
        db.prepare('DELETE FROM po_line_items').run();

        console.log('Deleting purchase_orders...');
        db.prepare('DELETE FROM purchase_orders').run();

        console.log('Deleting inventory_sheets...');
        db.prepare('DELETE FROM inventory_sheets').run();

        console.log('Deleting products...');
        db.prepare('DELETE FROM products').run();

        console.log('Deleting suppliers...');
        db.prepare('DELETE FROM suppliers').run();

        console.log('Deleting categories...');
        db.prepare('DELETE FROM categories').run();

        // Users are preserved
        console.log('Users table preserved.');
    })();

    db.exec('PRAGMA foreign_keys = ON');
    console.log('Database cleared successfully.');

} catch (error) {
    console.error('Failed to clear database:', error);
}
