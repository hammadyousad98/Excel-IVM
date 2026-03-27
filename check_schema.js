const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'inventory-management-system', 'inventory.db');
console.log('Opening DB at:', dbPath);

const db = new Database(dbPath);

const poDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='purchase_orders'").get();
console.log('Purchase Orders Schema:', poDef ? poDef.sql : 'Not Found');

const usersDef = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
console.log('Users Schema:', usersDef ? usersDef.sql : 'Not Found');
