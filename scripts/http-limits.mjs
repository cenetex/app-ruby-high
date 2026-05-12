export const MAX_BODY_BYTES = 1024 * 1024;

export function bodyLimitForPath(pathname) {
  void pathname;
  return MAX_BODY_BYTES;
}
