import { dbManager } from '../database'

export class SettingsRepository {
    get() {
        const stmt = dbManager.getDatabase().prepare('SELECT * FROM company_settings LIMIT 1')
        return stmt.get()
    }

    update(settings: { name: string; address: string; telephone: string; fax: string; ntn: string; logo_path: string }) {
        const existing = this.get()

        if (existing) {
            const stmt = dbManager.getDatabase().prepare(`
        UPDATE company_settings 
        SET name = @name, address = @address, telephone = @telephone, fax = @fax, ntn = @ntn, logo_path = @logo_path
        WHERE id = @id
      `)
            return stmt.run({ ...settings, id: (existing as any).id })
        } else {
            const stmt = dbManager.getDatabase().prepare(`
        INSERT INTO company_settings (name, address, telephone, fax, ntn, logo_path)
        VALUES (@name, @address, @telephone, @fax, @ntn, @logo_path)
      `)
            return stmt.run(settings)
        }
    }
}

export const settingsRepo = new SettingsRepository()
