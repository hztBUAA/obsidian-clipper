interface VaultDirectoryRecord {
	vault: string;
	handle: FileSystemDirectoryHandle;
}

type PermissionStateResult = 'granted' | 'denied' | 'prompt';

interface PermissionAwareDirectoryHandle extends FileSystemDirectoryHandle {
	requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionStateResult>;
	queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionStateResult>;
	entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
	values?: () => AsyncIterableIterator<FileSystemHandle>;
	[Symbol.asyncIterator]?: () => AsyncIterableIterator<FileSystemHandle>;
}

const DB_NAME = 'obsidian-clipper-fs';
const DB_VERSION = 1;
const STORE_NAME = 'vault-directories';

function supportsFileSystemAccess(): boolean {
	return typeof window !== 'undefined' && typeof indexedDB !== 'undefined' && 'showDirectoryPicker' in window;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'vault' });
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
	});
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, mode);
		const store = tx.objectStore(STORE_NAME);
		const request = operation(store);

		request.onsuccess = () => resolve(request.result as T);
		request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
		tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
		tx.oncomplete = () => db.close();
	});
}

async function getStoredRecord(vault: string): Promise<VaultDirectoryRecord | null> {
	if (!supportsFileSystemAccess()) {
		return null;
	}

	try {
		const result = await withStore<VaultDirectoryRecord | undefined>('readonly', (store) => store.get(vault));
		return result || null;
	} catch (error) {
		console.warn('Failed to read vault directory mapping:', error);
		return null;
	}
}

export async function linkVaultDirectory(vault: string): Promise<boolean> {
	if (!supportsFileSystemAccess() || !vault) {
		return false;
	}

	try {
		const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
		if (!picker) {
			return false;
		}
		const handle = await picker();
		const permissionHandle = handle as PermissionAwareDirectoryHandle;
		const permission = permissionHandle.requestPermission
			? await permissionHandle.requestPermission({ mode: 'readwrite' })
			: 'granted';
		if (permission !== 'granted') {
			return false;
		}

		await withStore<IDBValidKey>('readwrite', (store) => store.put({ vault, handle }));
		return true;
	} catch (error) {
		console.warn('Failed to link vault directory:', error);
		return false;
	}
}

export async function unlinkVaultDirectory(vault: string): Promise<void> {
	if (!supportsFileSystemAccess() || !vault) {
		return;
	}

	try {
		await withStore<undefined>('readwrite', (store) => store.delete(vault));
	} catch (error) {
		console.warn('Failed to unlink vault directory:', error);
	}
}

export async function getVaultDirectoryHandle(
	vault: string,
	mode: 'read' | 'readwrite' = 'read'
): Promise<FileSystemDirectoryHandle | null> {
	if (!vault) {
		return null;
	}

	const record = await getStoredRecord(vault);
	if (!record?.handle) {
		return null;
	}

	try {
		const permissionHandle = record.handle as PermissionAwareDirectoryHandle;
		let permission = permissionHandle.queryPermission
			? await permissionHandle.queryPermission({ mode })
			: 'granted';
		if (permission !== 'granted' && permissionHandle.requestPermission) {
			permission = await permissionHandle.requestPermission({ mode });
		}
		if (permission === 'granted') {
			return record.handle;
		}
		return null;
	} catch (error) {
		console.warn('Failed to query vault directory permission:', error);
		return null;
	}
}

export async function getVaultDirectoryStatus(vault: string): Promise<{ linked: boolean; name?: string }> {
	if (!vault) {
		return { linked: false };
	}
	const record = await getStoredRecord(vault);
	if (!record?.handle) {
		return { linked: false };
	}
	return { linked: true, name: record.handle.name };
}

async function getOrCreateDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
	const segments = path
		.replace(/\\/g, '/')
		.split('/')
		.map((part) => part.trim())
		.filter(Boolean);

	let current = root;
	for (const segment of segments) {
		current = await current.getDirectoryHandle(segment, { create: true });
	}
	return current;
}

async function uniqueFilename(handle: FileSystemDirectoryHandle, baseName: string, extension: string): Promise<string> {
	let index = 0;
	for (;;) {
		const suffix = index === 0 ? '' : `-${index}`;
		const filename = `${baseName}${suffix}${extension}`;
		try {
			await handle.getFileHandle(filename, { create: false });
			index += 1;
		} catch {
			return filename;
		}
	}
}

export async function writeBlobToVaultPath(
	vault: string,
	folderPath: string,
	baseName: string,
	extension: string,
	blob: Blob
): Promise<string | null> {
	const rootHandle = await getVaultDirectoryHandle(vault, 'readwrite');
	if (!rootHandle) {
		return null;
	}

	try {
		const targetDir = await getOrCreateDirectory(rootHandle, folderPath);
		const filename = await uniqueFilename(targetDir, baseName, extension);
		const fileHandle = await targetDir.getFileHandle(filename, { create: true });
		const writable = await fileHandle.createWritable();
		await writable.write(blob);
		await writable.close();
		return filename;
	} catch (error) {
		console.warn('Failed to write media to vault path:', error);
		return null;
	}
}

export async function collectVaultFolderPaths(vault: string, maxDepth = 4, maxCount = 300): Promise<string[]> {
	const rootHandle = await getVaultDirectoryHandle(vault, 'read');
	if (!rootHandle) {
		return [];
	}

	const folders: string[] = [];

	const iterateChildren = async function* (
		handle: PermissionAwareDirectoryHandle
	): AsyncGenerator<[string, FileSystemHandle]> {
		if (handle.entries) {
			for await (const tuple of handle.entries()) {
				yield tuple;
			}
			return;
		}

		if (handle.values) {
			for await (const entry of handle.values()) {
				yield [entry.name, entry];
			}
			return;
		}

		if (handle[Symbol.asyncIterator]) {
			for await (const entry of handle as unknown as AsyncIterable<FileSystemHandle>) {
				yield [entry.name, entry];
			}
		}
	};

	const walk = async (handle: FileSystemDirectoryHandle, parentPath: string, depth: number): Promise<void> => {
		if (depth > maxDepth || folders.length >= maxCount) {
			return;
		}

		const iterableHandle = handle as PermissionAwareDirectoryHandle;
		for await (const [name, entry] of iterateChildren(iterableHandle)) {
			if (entry.kind !== 'directory') {
				continue;
			}
			const nextPath = parentPath ? `${parentPath}/${name}` : name;
			folders.push(nextPath);
			if (folders.length >= maxCount) {
				return;
			}
			await walk(entry as FileSystemDirectoryHandle, nextPath, depth + 1);
		}
	};

	try {
		await walk(rootHandle, '', 1);
	} catch (error) {
		console.warn('Failed to collect vault folder paths:', error);
	}

	return folders;
}

export function isVaultDirectoryLinkingSupported(): boolean {
	return supportsFileSystemAccess();
}
