import { Collection, Note } from '../types';
import { secureStorage } from './secureStorage';

export const PENDING_CHANGES_KEY = 'cloudnotes_pending_changes';

export type ChangeType = 'collection' | 'note';
export type Operation = 'create' | 'update' | 'delete';

export interface PendingChange {
    type: ChangeType;
    op: Operation;
    id: string;
    collectionId?: string; // Required for notes
    data?: any; // The Note or Collection object for create/update
    timestamp: number;
}

class StorageService {
    private getStoredUserId(): string | null {
        return localStorage.getItem('cloudnotes_active_user');
    }

    // --- Tombstones (Recent Deletes) ---
    clearUserData(userId: string): void {
        try {
            // 1. Get Collections to identify note keys
            const collections = this.getLocalCollections(userId);
            const cachedCols = this.getCachedCollections(userId);
            const allCols = [...collections, ...cachedCols];

            // 2. Remove Notes for each collection
            allCols.forEach(col => {
                secureStorage.removeItem(`local_notes_${col.id}`);
                secureStorage.removeItem(`cached_notes_${col.id}`);
            });

            // 3. Remove Collections Keys
            secureStorage.removeItem(`local_collections_${userId}`);
            secureStorage.removeItem(`cached_collections_${userId}`);
            secureStorage.removeItem(`cloudnotes_collections_${userId}`);

            // 4. Remove Pending Changes
            secureStorage.removeItem(`cloudnotes_pending_changes_${userId}`);

            // 5. Remove Last Active Collection Preference
            secureStorage.removeItem(`cloudnotes_last_col_${userId}`);

        } catch (e) {
        }
    }

    // Clear only potential offline cache (server mirrors), keeping local edits safe
    clearSyncedData(userId: string): void {
        try {
            const cachedCols = this.getCachedCollections(userId);
            cachedCols.forEach(col => {
                secureStorage.removeItem(`cached_notes_${col.id}`);
            });
            secureStorage.removeItem(`cached_collections_${userId}`);
            // Also clear last background sync timestamp so it retries fresh if re-enabled
            secureStorage.removeItem(`cloudnotes_last_bg_sync_${userId}`);
        } catch (e) { }
    }

    saveRecentDelete(id: string): void {
        const key = 'cloudnotes_tombstones';
        let tombstones: { id: string, timestamp: number }[] = [];
        try {
            tombstones = JSON.parse(secureStorage.getItem(key) || '[]');
        } catch { }

        // Add new, remove duplicates of same ID
        tombstones = tombstones.filter(t => t.id !== id);
        tombstones.push({ id, timestamp: Date.now() });

        // Cleanup old (older than 30 mins)
        const expiry = 30 * 60 * 1000;
        const now = Date.now();
        tombstones = tombstones.filter(t => (now - t.timestamp) < expiry);

        secureStorage.setItem(key, JSON.stringify(tombstones));
    }

    isDeleted(id: string): boolean {
        const key = 'cloudnotes_tombstones';
        try {
            const raw = secureStorage.getItem(key);
            if (!raw) return false;
            const tombstones: { id: string, timestamp: number }[] = JSON.parse(raw);
            const expiry = 30 * 60 * 1000; // 30 mins
            return tombstones.some(t => t.id === id && (Date.now() - t.timestamp < expiry));
        } catch { return false; }
    }

    // --- Collections ---

    getCachedCollections(userId?: string): Collection[] {
        const uid = userId || this.getStoredUserId();
        if (!uid) return [];
        try {
            const data = secureStorage.getItem(`cached_collections_${uid}`);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    getLocalCollections(userId?: string): Collection[] {
        const uid = userId || this.getStoredUserId();
        if (!uid) return [];

        try {
            const data = secureStorage.getItem(`local_collections_${uid}`);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    saveLocalCollection(collection: Collection, userId?: string): void {
        const uid = userId || this.getStoredUserId();
        if (!uid) return;

        const collections = this.getLocalCollections(uid);
        // Update or Add
        const index = collections.findIndex(c => c.id === collection.id);
        if (index >= 0) {
            collections[index] = { ...collection };
        } else {
            collections.push({ ...collection });
        }

        secureStorage.setItem(`local_collections_${uid}`, JSON.stringify(collections));
    }

    deleteLocalCollection(id: string, userId?: string): void {
        const uid = userId || this.getStoredUserId();
        if (!uid) return;

        const collections = this.getLocalCollections(uid);
        const filtered = collections.filter(c => c.id !== id);
        secureStorage.setItem(`local_collections_${uid}`, JSON.stringify(filtered));
    }

    // --- Notes ---

    getCachedNotes(collectionId: string): Note[] {
        try {
            const data = secureStorage.getItem(`cached_notes_${collectionId}`);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    getLocalNotes(collectionId: string): Note[] {
        try {
            const data = secureStorage.getItem(`local_notes_${collectionId}`);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    saveLocalNote(note: Note, userId?: string): void {
        const notes = this.getLocalNotes(note.collectionId);
        const index = notes.findIndex(n => n.id === note.id);

        if (index >= 0) {
            notes[index] = { ...note };
        } else {
            notes.push({ ...note });
        }

        secureStorage.setItem(`local_notes_${note.collectionId}`, JSON.stringify(notes));
    }

    deleteLocalNote(collectionId: string, noteId: string, userId?: string): void {
        const notes = this.getLocalNotes(collectionId);
        const filtered = notes.filter(n => n.id !== noteId);
        secureStorage.setItem(`local_notes_${collectionId}`, JSON.stringify(filtered));
    }

    // Batch helpers for persistence (Updating Cache)
    saveSyncedCollections(collections: Collection[], userId: string): void {
        // Save purely to cache
        secureStorage.setItem(`cached_collections_${userId}`, JSON.stringify(collections));
    }

    saveSyncedNotes(collectionId: string, fetchedNotes: Note[]): void {
        // Save purely to cache
        secureStorage.setItem(`cached_notes_${collectionId}`, JSON.stringify(fetchedNotes));
    }

    // --- Pending Changes ---

    getPendingChanges(userId?: string): PendingChange[] {
        const uid = userId || this.getStoredUserId();
        if (!uid) return [];

        try {
            const data = secureStorage.getItem(`${PENDING_CHANGES_KEY}_${uid}`);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    queueChange(item: PendingChange, userId?: string): void {
        const uid = userId || this.getStoredUserId();
        if (!uid) return;

        let pending = this.getPendingChanges(uid);

        if (item.op === 'delete') {
            // Check if there's a pending create. If so, just remove it and don't add the delete.
            const existingCreate = pending.find(p => p.id === item.id && p.type === item.type && p.op === 'create');
            if (existingCreate) {
                // It was created offline then deleted. It never existed on server.
                pending = pending.filter(p => p.id !== item.id || p.type !== item.type);
                secureStorage.setItem(`${PENDING_CHANGES_KEY}_${uid}`, JSON.stringify(pending));
                return;
            }
            // Remove previous pending updates for this item as they are now moot
            pending = pending.filter(p => !(p.id === item.id && p.type === item.type && p.op === 'update'));
        } else if (item.op === 'update') {
            // If there is an existing 'create' for this item, keep it as 'create' but update data
            const existingCreate = pending.find(p => p.id === item.id && p.type === item.type && p.op === 'create');
            if (existingCreate) {
                existingCreate.data = item.data;
                // Don't add the update, just modify the create
                secureStorage.setItem(`${PENDING_CHANGES_KEY}_${uid}`, JSON.stringify(pending));
                return;
            }
            // If existing update, replace it
            const existingUpdateIndex = pending.findIndex(p => p.id === item.id && p.type === item.type && p.op === 'update');
            if (existingUpdateIndex >= 0) {
                pending[existingUpdateIndex] = item;
                secureStorage.setItem(`${PENDING_CHANGES_KEY}_${uid}`, JSON.stringify(pending));
                return;
            }
        } else if (item.op === 'create') {
            // Ensure we don't have dupes (though this shouldn't happen properly)
        }

        pending.push(item);
        secureStorage.setItem(`${PENDING_CHANGES_KEY}_${uid}`, JSON.stringify(pending));
    }

    clearPendingChanges(userId?: string): void {
        const uid = userId || this.getStoredUserId();
        if (!uid) return;
        secureStorage.removeItem(`${PENDING_CHANGES_KEY}_${uid}`);
    }

    removePendingChange(id: string, type: ChangeType, op: Operation, userId?: string): void {
        const uid = userId || this.getStoredUserId();
        if (!uid) return;
        const pending = this.getPendingChanges(uid);
        // Use exact match or just ID/Type match?
        // Safe to remove specific op instance.
        const filtered = pending.filter(p => !(p.id === id && p.type === type && p.op === op));
        secureStorage.setItem(`${PENDING_CHANGES_KEY}_${uid}`, JSON.stringify(filtered));
    }
}

export const storage = new StorageService();
