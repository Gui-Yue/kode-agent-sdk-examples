export interface ParsedCommand {
  type: 'confirm' | 'cancel' | 'status' | 'history' | 'help';
  args: string[];
}

const COMMAND_MAP: Record<string, ParsedCommand['type']> = {
  '/confirm': 'confirm',
  '/cancel': 'cancel',
  '/status': 'status',
  '/history': 'history',
  '/help': 'help',
};

export function parseCommand(message: string): ParsedCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const type = COMMAND_MAP[cmd];
  if (!type) return null;

  return { type, args: parts.slice(1) };
}
