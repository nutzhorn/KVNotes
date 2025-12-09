import { openDB, DBSchema, IDBPDatabase } from 'idb';

const DB_NAME = 'cloudnotes_db';
const DB_VERSION = 1;
const STORE_NAME = 'keyval';

interface CloudNotesDB extends DBSchema {
    [STORE_NAME]: {
        key: string;
        value: { iv: Uint8Array; data: ArrayBuffer };
    };
}

class SecureStorageService {
    private dbPromise: Promise<IDBPDatabase<CloudNotesDB>> | null = null;
    private encryptionKey: CryptoKey | null = null;
    private memoryCache: Map<string, string> = new Map();
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;

    constructor() { }

    async init() {
        if (this.isInitialized) return;
        if (this.dbPromise && !this.isInitialized) {
            // If dbPromise is set but not initialized, it means we are already initializing (or failed)
            // But actually dbPromise is set in step 1.
            // We need a separate init promise to return.
        }
        // Better:
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            // 1. Initialize DB
            this.dbPromise = openDB<CloudNotesDB>(DB_NAME, DB_VERSION, {
                upgrade(db) {
                    db.createObjectStore(STORE_NAME);
                },
            });

            // 2. Get or Create Encryption Key
            await this.setupKey();

            // 3. Migration (if needed)
            await this.migrateIfNeeded();

            // 4. Load all data into memory
            await this.loadAll();

            this.isInitialized = true;
            // console.log('[SecureStorage] Initialized');
        })();

        return this.initPromise;
    }

    private async migrateIfNeeded() {
        if (!this.dbPromise) return;
        const db = await this.dbPromise;
        const count = await db.count(STORE_NAME);

        // Only migrate if DB is empty and we have localStorage data
        if (count === 0 && localStorage.length > 0) {
            // console.log('[SecureStorage] Migrating from localStorage...');
            const keysToMigrate = [];

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key !== 'cloudnotes_muk' && key !== 'cloudnotes_active_user' && (key.startsWith('cloudnotes_') || key.startsWith('local_') || key.startsWith('cached_'))) {
                    keysToMigrate.push(key);
                }
            }

            for (const key of keysToMigrate) {
                const val = localStorage.getItem(key);
                if (val) {
                    try {
                        // Deadlock fix: Do not call this.persist() here because it awaits initPromise,
                        // which is currently running this function. Use direct persistence instead.
                        if (this.encryptionKey) {
                            const { iv, data } = await this.encrypt(val);
                            await db.put(STORE_NAME, { iv, data }, key);
                            localStorage.removeItem(key); // Cleanup insecure copy only if persist succeeded
                        }
                    } catch (e) {
                        console.error(`[SecureStorage] Failed to migrate key ${key}, keeping in localStorage`, e);
                    }
                }
            }
            // console.log(`[SecureStorage] Migrated ${keysToMigrate.length} items.`);
        }
    }

    private async setupKey() {
        const KEY_STORAGE_NAME = 'cloudnotes_muk';
        // Ideally, this key wraps the actual encryption key, or is the key itself.
        // For "device only" transparency, we store the key in localStorage (obfuscated)
        // or generate one if missing.
        // Note: Storing key in localStorage means it's not "secure" against root access/malware,
        // but protects against casual IndexedDB dumping.
        // A better approach for the future is requiring a password to derive this key.

        let exportedKey = localStorage.getItem(KEY_STORAGE_NAME);

        if (!exportedKey) {
            this.encryptionKey = await window.crypto.subtle.generateKey(
                {
                    name: 'AES-GCM',
                    length: 256,
                },
                true,
                ['encrypt', 'decrypt']
            );

            const exported = await window.crypto.subtle.exportKey('jwk', this.encryptionKey);
            localStorage.setItem(KEY_STORAGE_NAME, JSON.stringify(exported));
        } else {
            try {
                const jwk = JSON.parse(exportedKey);
                this.encryptionKey = await window.crypto.subtle.importKey(
                    'jwk',
                    jwk,
                    { name: 'AES-GCM' },
                    true,
                    ['encrypt', 'decrypt']
                );
            } catch (e) {
                console.error('Failed to import key, regenerating', e);
                // Fallback: dangerous (dataloss) but necessary if key is corrupted
                localStorage.removeItem(KEY_STORAGE_NAME);
                return this.setupKey();
            }
        }
    }

    private async loadAll() {
        if (!this.dbPromise || !this.encryptionKey) return;
        const db = await this.dbPromise;
        const keys = await db.getAllKeys(STORE_NAME);

        for (const key of keys) {
            const record = await db.get(STORE_NAME, key);
            if (record) {
                try {
                    const decrypted = await this.decrypt(record.data, record.iv);
                    this.memoryCache.set(key, decrypted);
                } catch (e) {
                    console.warn(`[SecureStorage] Failed to decrypt key ${key}, deleting invalid entry.`, e);
                    try {
                        await db.delete(STORE_NAME, key);
                    } catch (delErr) {
                        console.error(`[SecureStorage] Failed to delete invalid key ${key}`, delErr);
                    }
                }
            }
        }
    }

    private async encrypt(data: string): Promise<{ iv: Uint8Array; data: ArrayBuffer }> {
        if (!this.encryptionKey) throw new Error('No key');
        const encoder = new TextEncoder();
        const encodedData = encoder.encode(data);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const encryptedData = await window.crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv,
            },
            this.encryptionKey,
            encodedData as any
        );

        return { iv, data: encryptedData };
    }

    private async decrypt(data: ArrayBuffer, iv: Uint8Array): Promise<string> {
        if (!this.encryptionKey) throw new Error('No key');
        const decryptedData = await window.crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: iv as any,
            },
            this.encryptionKey,
            data
        );

        const decoder = new TextDecoder();
        return decoder.decode(decryptedData);
    }

    // --- Public Sync API (Mimics localStorage) ---

    getItem(key: string): string | null {
        return this.memoryCache.get(key) || null;
    }

    setItem(key: string, value: string): void {
        // 1. Update Memory
        this.memoryCache.set(key, value);

        // 2. Persist Async
        this.persist(key, value);
    }

    removeItem(key: string): void {
        this.memoryCache.delete(key);
        this.remove(key);
    }

    clear(): void {
        this.memoryCache.clear();
        if (this.dbPromise) {
            this.dbPromise.then(db => db.clear(STORE_NAME));
        }
    }

    // --- Async Persistence Helpers ---

    private async persist(key: string, value: string) {
        try {
            if (this.initPromise && !this.isInitialized) {
                await this.initPromise;
            }
            if (!this.dbPromise || !this.encryptionKey) return;

            const { iv, data } = await this.encrypt(value);
            const db = await this.dbPromise;
            await db.put(STORE_NAME, { iv, data }, key);
        } catch (error) {
            console.error('[SecureStorage] Persist failed:', error);
        }
    }

    private async remove(key: string) {
        if (!this.dbPromise) return;
        const db = await this.dbPromise;
        await db.delete(STORE_NAME, key);
    }
}

export const secureStorage = new SecureStorageService();
