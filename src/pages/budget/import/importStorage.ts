/**
 * Called once before the first write of an import so a backup can be taken. The default does nothing; the
 * data safety net can supply one. A snapshot that throws never blocks the import.
 */
export type PreImportSnapshot = (reason: 'import') => Promise<void>

export const noopPreImportSnapshot: PreImportSnapshot = async () => {}
