const Database = require('better-sqlite3');
const path = require('path');

const dbPath = 'C:\\Users\\DELL\\AppData\\Roaming\\inventory-management-system\\inventory.db';

try {
    console.log('Opening database:', dbPath);
    const db = new Database(dbPath);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables:', tables.map(t => t.name).join(', '));

    // Check common tables for warehouse info
    const possibleTables = ['warehouses', 'inventory_transactions', 'rm_inventory_transactions'];

    for (const table of possibleTables) {
        const check = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`).get();
        if (check) {
            console.log(`\n--- Data from ${table} ---`);
            const data = db.prepare(`SELECT * FROM ${table} LIMIT 10`).all();
            console.log(JSON.stringify(data, null, 2));
        }
    }

} catch (err) {
    console.error('Error:', err.message);
}
