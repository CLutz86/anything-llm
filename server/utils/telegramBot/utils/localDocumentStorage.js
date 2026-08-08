const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");

/**
 * Manages local storage of Telegram documents.
 * 
 * When a user sends a file via Telegram, the raw file is saved here
 * so it can be retrieved later when the user asks about it.
 * 
 * Each document is stored with metadata in a JSON index file.
 * 
 * Storage layout:
 *   server/storage/telegram-documents/
 *     index.json         -> { documents: [{ id, chatId, originalName, storedName, date, mimeType }] }
 *     files/             -> {storedName}
 */
class LocalDocumentStorage {
  static #instance = null;

  constructor() {
    if (LocalDocumentStorage._instance) return LocalDocumentStorage._instance;
    LocalDocumentStorage._instance = this;
  }

  /**
   * Get the root storage directory for Telegram documents.
   * @returns {string}
   */
  getStorageRoot() {
    const storageDir =
      process.env.STORAGE_DIR ||
      path.resolve(__dirname, "../../../../storage");
    return path.join(storageDir, "telegram-documents");
  }

  /**
   * Get the index file path.
   * @returns {string}
   */
  getIndexPath() {
    return path.join(this.getStorageRoot(), "index.json");
  }

  /**
   * Get the files directory path.
   * @returns {string}
   */
  getFilesDir() {
    return path.join(this.getStorageRoot(), "files");
  }

  /**
   * Ensure storage directories exist.
   * @returns {Promise<void>}
   */
  async ensureDirectories() {
    await fs.mkdir(this.getFilesDir(), { recursive: true });
    try {
      await fs.access(this.getIndexPath());
    } catch {
      await fs.writeFile(
        this.getIndexPath(),
        JSON.stringify({ documents: [] }, null, 2),
        "utf-8"
      );
    }
  }

  /**
   * Read the current index.
   * @returns {Promise<Array>}
   */
  async readIndex() {
    try {
      const raw = await fs.readFile(this.getIndexPath(), "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.documents) ? parsed.documents : [];
    } catch {
      return [];
    }
  }

  /**
   * Write the index.
   * @param {Array} documents
   * @returns {Promise<void>}
   */
  async writeIndex(documents) {
    await fs.writeFile(
      this.getIndexPath(),
      JSON.stringify({ documents }, null, 2),
      "utf-8"
    );
  }

  /**
   * Sanitize a filename to be safe for storage.
   * @param {string} name
   * @returns {string}
   */
  sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 200);
  }

  /**
   * Save a document received from Telegram.
   * @param {object} params
   * @param {number} params.chatId - Telegram chat ID
   * @param {string} params.fileId - Telegram file ID
   * @param {string} params.originalName - Original filename
   * @param {Buffer} params.buffer - File content
   * @param {string} [params.mimeType] - MIME type
   * @returns {Promise<{id: string, originalName: string, storedName: string}>}
   */
  async saveDocument({ chatId, fileId, originalName, buffer, mimeType }) {
    await this.ensureDirectories();

    const sanitized = this.sanitizeFilename(originalName || "document");
    const timestamp = Date.now();
    const id = `telegram-doc-${timestamp}`;
    const ext = path.extname(sanitized) || "";
    const baseName = path.basename(sanitized, ext);
    const storedName = `${baseName}-${timestamp}${ext}`;
    const filePath = path.join(this.getFilesDir(), storedName);

    // Write file
    await fs.writeFile(filePath, buffer);
    console.log(
      `[LocalDocumentStorage] Saved document: ${storedName} (${buffer.length} bytes)`
    );

    // Update index
    const documents = await this.readIndex();
    documents.push({
      id,
      chatId: String(chatId),
      fileId,
      originalName: originalName || "document",
      storedName,
      date: new Date().toISOString(),
      mimeType: mimeType || "application/octet-stream",
      size: buffer.length,
    });
    await this.writeIndex(documents);

    return { id, originalName: originalName || "document", storedName };
  }

  /**
   * List all stored documents, optionally filtered by chatId.
   * @param {number} [chatId]
   * @returns {Promise<Array>}
   */
  async listDocuments(chatId) {
    const documents = await this.readIndex();
    if (chatId !== undefined) {
      return documents.filter((d) => String(d.chatId) === String(chatId));
    }
    return documents;
  }

  /**
   * Find documents by name (fuzzy match).
   * @param {string} query - Search term
   * @param {number} [chatId] - Optional chat filter
   * @returns {Promise<Array>}
   */
  async searchDocuments(query, chatId) {
    const documents = await this.readIndex();
    const q = query.toLowerCase();
    let results = documents.filter((d) => {
      return (
        d.originalName.toLowerCase().includes(q) ||
        d.storedName.toLowerCase().includes(q)
      );
    });
    if (chatId !== undefined) {
      results = results.filter((d) => String(d.chatId) === String(chatId));
    }
    return results;
  }

  /**
   * Get a stored document by its storedName.
   * @param {string} storedName
   * @returns {Promise<{buffer: Buffer, metadata: object} | null>}
   */
  async getDocument(storedName) {
    const documents = await this.readIndex();
    const meta = documents.find((d) => d.storedName === storedName);
    if (!meta) return null;

    const filePath = path.join(this.getFilesDir(), storedName);
    try {
      const buffer = await fs.readFile(filePath);
      return { buffer, metadata: meta };
    } catch {
      return null;
    }
  }

  /**
   * Get a document by its unique ID.
   * @param {string} id
   * @returns {Promise<{buffer: Buffer, metadata: object} | null>}
   */
  async getDocumentById(id) {
    const documents = await this.readIndex();
    const meta = documents.find((d) => d.id === id);
    if (!meta) return null;

    const filePath = path.join(this.getFilesDir(), meta.storedName);
    try {
      const buffer = await fs.readFile(filePath);
      return { buffer, metadata: meta };
    } catch {
      return null;
    }
  }

  /**
   * Delete a document by storedName.
   * @param {string} storedName
   * @returns {Promise<boolean>}
   */
  async deleteDocument(storedName) {
    const documents = await this.readIndex();
    const idx = documents.findIndex((d) => d.storedName === storedName);
    if (idx === -1) return false;

    const filePath = path.join(this.getFilesDir(), storedName);
    try {
      await fs.unlink(filePath);
    } catch {
      // File may already be gone
    }

    documents.splice(idx, 1);
    await this.writeIndex(documents);
    return true;
  }
}

module.exports = new LocalDocumentStorage();