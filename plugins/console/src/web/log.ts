export type LogLevel = 'error' | 'warn' | 'info';

const LEVEL = /\[[^\][]*[/ ](TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE)\]/;

/**
 * The level of a server log line: vanilla and Fabric write `[12:00:00] [Server thread/WARN]: …`,
 * Paper `[12:00:00 WARN]: …`. Lines without a level (such as stack traces) count as info.
 */
export function logLevel(text: string): LogLevel {
  const level = LEVEL.exec(text)?.[1];
  if (level === 'ERROR' || level === 'FATAL' || level === 'SEVERE') return 'error';
  if (level === 'WARN' || level === 'WARNING') return 'warn';
  return 'info';
}
