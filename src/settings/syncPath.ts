export const WEBDAV_PREFIX = "/WebDAV/";

export function normalizeWebdavPath(input: string): string {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return WEBDAV_PREFIX;
  const normalized = trimmed.replace(/\/+$/, "");
  if (normalized === "/WebDAV") return WEBDAV_PREFIX;
  return normalized || WEBDAV_PREFIX;
}

export function webdavPathError(input: string): string | null {
  const path = normalizeWebdavPath(input);
  if (!path.startsWith(WEBDAV_PREFIX)) {
    return "同步目录必须位于 /WebDAV/ 下，例如 /WebDAV/Obsidian。";
  }
  const rest = path.slice(WEBDAV_PREFIX.length);
  if (!rest) {
    return "请填写 /WebDAV/ 下一级的文件夹名，例如 /WebDAV/Obsidian。";
  }
  if (rest.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return "路径中不能包含空目录名、. 或 ..。";
  }
  if (path.includes("\\") || Array.from(path).some((ch) => ch.charCodeAt(0) < 32)) {
    return "路径包含不支持的字符。";
  }
  return null;
}

export function isWebdavSyncPath(input: string): boolean {
  return webdavPathError(input) === null;
}
