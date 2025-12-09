import { Collection, Note, User } from '../types';
import { secureStorage } from './secureStorage';

class ApiService {
  public user: User | null = null;

  setUser(user: User) {
    this.user = user;
  }

  private getHeaders(user?: User) {
    const u = user || this.user;
    return {
      'Authorization': `Bearer ${u?.apiToken}`,
      'Content-Type': 'application/json'
    };
  }

  private getUrl(path: string, user?: User): string {
    const u = user || this.user;
    const baseUrl = u?.apiUrl || '';
    const target = `${baseUrl}${path}`;

    return target;
  }

  private async fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
    try {
      const res = await fetch(url, options);
      // Retry on Server Errors (5xx)
      if (res.status >= 500 && retries > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return this.fetchWithRetry(url, options, retries - 1);
      }
      return res;
    } catch (e) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return this.fetchWithRetry(url, options, retries - 1);
      }
      throw e;
    }
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.getCollections();
      return true;

    } catch (e) {
      throw e;
    }
  }

  async getCollections(user?: User): Promise<Collection[]> {
    const u = user || this.user;
    if (!u) return [];

    const cacheKey = `cloudnotes_cache_collections_${u.id}`;

    try {
      const res = await this.fetchWithRetry(this.getUrl('/collections', u), {
        headers: this.getHeaders(u)
      });
      if (!res.ok) {
        let text = "";
        try { text = await res.text(); } catch (e) { }
        throw new Error(`HTTP error! status: ${res.status}${text ? ' - ' + text : ''}`);
      }
      const data = await res.json();

      // Update cache
      secureStorage.setItem(cacheKey, JSON.stringify(data));
      return data;
    } catch (error) {
      const cached = secureStorage.getItem(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {
        }
      }

      // If no cache and network failed, rethrow or return empty
      // But for better UX, if it's explicitly an offline error, we might want to suppress
      // For now, we assume the UI handles the "empty" state or error state if needed.
      // But usually returning [] is better than crashing if we just want "view" mode.
      if (!navigator.onLine) {
        return []; // Or whatever was in cache (which was null)
      }
      throw error;
    }
  }

  async createCollection(name: string, id?: string): Promise<Collection> {
    if (!this.user) throw new Error("User not authenticated");

    const res = await this.fetchWithRetry(this.getUrl('/collections'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ name, id })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async updateCollection(id: string, name: string): Promise<Collection> {
    if (!this.user) throw new Error("User not authenticated");

    const res = await this.fetchWithRetry(this.getUrl(`/collections/${id}`), {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async deleteCollection(id: string): Promise<void> {
    if (!this.user) throw new Error("User not authenticated");

    const res = await this.fetchWithRetry(this.getUrl(`/collections/${id}`), {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
  }

  // --- Notes ---

  async getNotes(collectionId: string, user?: User): Promise<Note[]> {
    const u = user || this.user;
    if (!u) return [];

    const cacheKey = `cloudnotes_cache_notes_${collectionId}`;

    try {
      const res = await this.fetchWithRetry(this.getUrl(`/collections/${collectionId}/notes`, u), {
        headers: this.getHeaders(u)
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();

      secureStorage.setItem(cacheKey, JSON.stringify(data));
      return data;
    } catch (error) {
      const cached = secureStorage.getItem(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (e) {
        }
      }
      if (!navigator.onLine) return [];
      throw error;
    }
  }

  async createNote(collectionId: string, text: string, id?: string): Promise<Note> {
    if (!this.user) throw new Error("User not authenticated");

    const res = await this.fetchWithRetry(this.getUrl(`/collections/${collectionId}/notes`), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ text, id })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async updateNote(collectionId: string, noteId: string, text: string): Promise<Note> {
    if (!this.user) throw new Error("User not authenticated");

    const res = await this.fetchWithRetry(this.getUrl(`/collections/${collectionId}/notes/${noteId}`), {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ text })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async deleteNote(collectionId: string, noteId: string): Promise<void> {
    if (!this.user) throw new Error("User not authenticated");

    const res = await this.fetchWithRetry(this.getUrl(`/collections/${collectionId}/notes/${noteId}`), {
      method: 'DELETE',
      headers: this.getHeaders()
    });
    if (!res.ok) throw new Error(await res.text());
  }
}

export const api = new ApiService();