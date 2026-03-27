const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Path to the database
// The user data path is usually %APPDATA%/... but I need to find where the app stores it.
// In database.ts: join(app.getPath('userData'), 'inventory.db')
// I don't have access to 'electron' module here easily to get getPath.
// But I can try to find the database file.
// The user provided terminal output shows: D:\WorkingProjects\Excel inventory management\src
// The database is likely in the user data directory.
// I'll try to guess or search for .db files.

// Actually, I can use the same logic as the app if I can import it, but importing electron in a node script is hard.
// I'll search for 'inventory.db' in the user's home directory or app data.
// Or I can ask the user? No, I should try to find it.
// The user's OS is Windows. AppData is usually C:\Users\DELL\AppData\Roaming\...
// The app name is likely "Excel inventory management" or similar (from package.json).

// Let's check package.json to see the app name.
const packageJsonPath = path.join('d:\\WorkingProjects\\Excel inventory management', 'package.json');
if (fs.existsSync(packageJsonPath)) {
    const pkg = require(packageJsonPath);
    console.log('App Name:', pkg.name);
    // Construct path: C:\Users\DELL\AppData\Roaming\<AppName>\inventory.db
    const appData = process.env.APPDATA || 'C:\\Users\\DELL\\AppData\\Roaming';
    const dbPath = path.join(appData, pkg.name, 'inventory.db'); // Or pkg.productName
    console.log('Checking DB Path:', dbPath);

    if (fs.existsSync(dbPath)) {
        inspectDb(dbPath);
    } else {
        // Try productName
        const productName = pkg.productName || pkg.name;
        const dbPath2 = path.join(appData, productName, 'inventory.db');
        console.log('Checking DB Path 2:', dbPath2);
        if (fs.existsSync(dbPath2)) {
            inspectDb(dbPath2);
        } else {
            console.log('Could not find inventory.db');
        }
    }
}

function inspectDb(dbPath) {
    console.log('Opening database:', dbPath);
    const db = new Database(dbPath, { verbose: console.log });

    console.log('\n--- sqlite_master ---');
    const master = db.prepare("SELECT * FROM sqlite_master WHERE name LIKE 'purchase_orders%'").all();
    console.log(JSON.stringify(master, null, 2));

    console.log('\n--- Triggers ---');
    const triggers = db.prepare("SELECT * FROM sqlite_master WHERE type='trigger'").all();
    console.log(JSON.stringify(triggers, null, 2));
}
