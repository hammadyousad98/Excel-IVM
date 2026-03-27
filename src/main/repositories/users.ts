import { dbManager } from '../database'

export class UserRepository {
    getAll() {
        return dbManager.getDatabase().prepare('SELECT id, username, role FROM users').all()
    }

    create(user: any) {
        return dbManager.getDatabase().prepare('INSERT INTO users (username, password_hash, role) VALUES (@username, @password_hash, @role)').run(user)
    }

    findByUsername(username: string) {
        return dbManager.getDatabase().prepare('SELECT * FROM users WHERE username = ?').get(username)
    }

    login(username: string, password: string) {
        const user = this.findByUsername(username) as any
        if (user && user.password_hash === password) {
            const { password_hash, ...userWithoutPassword } = user
            return userWithoutPassword
        }
        return null
    }
}

export const userRepo = new UserRepository()
