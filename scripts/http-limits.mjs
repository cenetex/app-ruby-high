export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_IMPORT_BODY_BYTES = 16 * 1024 * 1024;
export const IMPORT_BODY_HOST_CAP_BYTES = MAX_IMPORT_BODY_BYTES + 1024 * 1024;

const LARGE_IMPORT_PATHS = new Set([
  "/api/apps/ruby-high/packs/import-anki",
  "/api/apps/ruby-high/packs/import-pdf",
]);

export function bodyLimitForPath(pathname) {
  return LARGE_IMPORT_PATHS.has(pathname)
    ? IMPORT_BODY_HOST_CAP_BYTES
    : MAX_BODY_BYTES;
}
