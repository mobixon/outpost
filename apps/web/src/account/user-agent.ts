/** A short description like "Firefox · Linux" for the sessions list. Not a full parser. */
export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;
  // Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari",
  // Android also says "Linux" and iOS also says "Mac OS X".
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : null;
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os;
}
