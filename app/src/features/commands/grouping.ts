import type { CommandInfo } from '../../services/api';

export type Section = { title: string; items: CommandInfo[] };

/** Groups commands by `section`, keeping the order in which sections first appear. */
export function groupBySection(commands: CommandInfo[]): Section[] {
  const order: string[] = [];
  const map = new Map<string, CommandInfo[]>();
  for (const c of commands) {
    const title = c.section?.trim() || 'General';
    if (!map.has(title)) {
      map.set(title, []);
      order.push(title);
    }
    map.get(title)!.push(c);
  }
  return order.map((title) => ({ title, items: map.get(title)! }));
}
