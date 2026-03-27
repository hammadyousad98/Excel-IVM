const Database = require('better-sqlite3');
const { join } = require('path');
const { app } = require('electron');

// Mock app.getPath for testing if needed, but here we'll just try to find the db
// In a real electron app, it's in userData.
// For this test, I'll try to find it in the expected location or a common one.

try {
    const dbPath = 'C:\\Users\\DELL\\AppData\\Roaming\\inventory-management-system\\inventory.db';
    const db = new Database(dbPath, { verbose: console.log });

    console.log('Categories:');
    const categories = db.prepare('SELECT * FROM categories').all();
    console.log(categories);

    console.log('Products:');
    const products = db.prepare('SELECT * FROM products').all();
    console.log(products);

    console.log('Inventory Join Query:');
    const data = db.prepare(`
      SELECT 
        p.*, 
        c.name as category_name,
        COALESCE(SUM(it.quantity), 0) as current_stock,
        COALESCE(MAX(it.rate), 0) as last_rate
      FROM products p 
      JOIN categories c ON p.category_id = c.id
      LEFT JOIN inventory_transactions it ON p.id = it.product_id
      GROUP BY p.id
    `).all();
    console.log(data);

} catch (err) {
    console.error('Test failed:', err);
}
