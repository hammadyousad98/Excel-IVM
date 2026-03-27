import { dbManager } from '../database'

export class SupplierRepository {
    private getTableName(type: string = 'raw_material'): string {
        return type === 'finished_goods' ? 'fg_buyers' : 'rm_suppliers'
    }

    getAll(type: string = 'raw_material') {
        const table = this.getTableName(type)
        const manager = dbManager as any
        if (!manager) return []
        return manager.getDatabase().prepare(`SELECT * FROM ${table}`).all()
    }

    create(supplier: any) {
        const { name, contact_info, address, telephone, fax, type } = supplier
        const table = this.getTableName(type || 'raw_material')
        const manager = dbManager as any
        if (!manager) throw new Error('Database not initialized')
        return manager.getDatabase().prepare(`
            INSERT INTO ${table} (name, contact_info, address, telephone, fax) 
            VALUES (@name, @contact_info, @address, @telephone, @fax)
        `).run({ name, contact_info, address, telephone, fax })
    }

    createBulk(suppliers: any[]) {
        const manager = dbManager as any
        if (!manager) throw new Error('Database not initialized')
        const db = manager.getDatabase()

        const transaction = db.transaction((data: any[]) => {
            let result
            for (const supplier of data) {
                const table = this.getTableName(supplier.type || 'raw_material')
                const insert = db.prepare(`
                    INSERT INTO ${table} (name, contact_info, address, telephone, fax) 
                    VALUES (@name, @contact_info, @address, @telephone, @fax)
                `)
                result = insert.run({
                    name: supplier.name,
                    contact_info: supplier.contact_info,
                    address: supplier.address,
                    telephone: supplier.telephone,
                    fax: supplier.fax
                })
            }
            return result
        })

        return transaction(suppliers)
    }

    update(id: number, supplier: any, type: string = 'raw_material') {
        const { name, contact_info, address, telephone, fax } = supplier
        const table = this.getTableName(type)
        const transactionsTable = type === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions'

        // Get old name to cascade update
        const manager = dbManager as any
        if (!manager) throw new Error('Database not initialized')

        const oldSupplier = manager.getDatabase().prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as any

        const result = manager.getDatabase().prepare(`
            UPDATE ${table} 
            SET name = @name, contact_info = @contact_info, address = @address, telephone = @telephone, fax = @fax
            WHERE id = @id
        `).run({ id, name, contact_info, address, telephone, fax })

        // Cascade update to inventory_transactions
        if (oldSupplier && oldSupplier.name !== name) {
            manager.getDatabase().prepare(`
                UPDATE ${transactionsTable} 
                SET manual_supplier_name = ? 
                WHERE manual_supplier_name = ?
            `).run(name, oldSupplier.name)
        }

        return result
    }

    delete(id: number, type: string = 'raw_material') {
        const table = this.getTableName(type)
        const transactionsTable = type === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions'

        // Get name to cascade delete (clear field)
        const manager = dbManager as any
        if (!manager) throw new Error('Database not initialized')

        const supplier = manager.getDatabase().prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as any

        const result = manager.getDatabase().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)

        // Cascade delete to inventory_transactions (set to null or keep? User said "deleted from inventory column")
        // We will set it to NULL/Empty to reflect "deleted"
        if (supplier) {
            manager.getDatabase().prepare(`
                UPDATE ${transactionsTable} 
                SET manual_supplier_name = NULL 
                WHERE manual_supplier_name = ?
            `).run(supplier.name)
        }

        return result
    }

    resetAndSeed(suppliersList: string[], type: string = 'raw_material') {
        const manager = dbManager as any
        if (!manager) throw new Error('Database not initialized')
        const db = manager.getDatabase()
        const suppliersTable = this.getTableName(type)
        const categoriesTable = type === 'finished_goods' ? 'fg_categories' : 'rm_categories'
        const productsTable = type === 'finished_goods' ? 'fg_products' : 'rm_products'
        const transactionsTable = type === 'finished_goods' ? 'fg_inventory_transactions' : 'rm_inventory_transactions'
        const sheetsTable = type === 'finished_goods' ? 'fg_inventory_sheets' : 'rm_inventory_sheets'
        const poTable = type === 'finished_goods' ? 'fg_delivery_orders' : 'rm_purchase_orders'
        const poLineItemsTable = type === 'finished_goods' ? 'fg_do_line_items' : 'rm_po_line_items'

        return db.transaction(() => {
            // 1. Delete Inventory Data for this section only
            db.prepare(`DELETE FROM ${transactionsTable}`).run()
            db.prepare(`DELETE FROM ${sheetsTable}`).run()
            db.prepare(`DELETE FROM ${productsTable}`).run()
            db.prepare(`DELETE FROM ${categoriesTable}`).run()

            // 2. Delete PO/DO Data for this section only
            db.prepare(`DELETE FROM ${poLineItemsTable}`).run()
            db.prepare(`DELETE FROM ${poTable}`).run()

            // 3. Delete Suppliers/Buyers
            db.prepare(`DELETE FROM ${suppliersTable}`).run()

            // 4. Seed new suppliers/buyers
            const insert = db.prepare(`INSERT INTO ${suppliersTable} (name) VALUES (?)`)
            for (const name of suppliersList) {
                insert.run(name)
            }

            // 5. Seed default categories (to keep app usable)
            const categories = ['Chemicals', 'Coatings', 'Consumable', 'Corrugating', 'CTP', 'Films', 'Inks', 'PAPER & BOARD']
            const insertCat = db.prepare(`INSERT INTO ${categoriesTable} (name) VALUES (?)`)
            for (const cat of categories) {
                insertCat.run(cat)
            }
        })()
    }
}

export const supplierRepo = new SupplierRepository()
