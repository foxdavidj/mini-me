import type { ReviewItem } from './review';

// Keep the full sender address: creator+123 and creator+456 may be different newsletters.
export function sourceKey(from: string): string {
  return (from.match(/<([^<>]+)>/)?.[1] ?? from).trim().toLowerCase();
}
export function sourceName(from: string): string {
  return from.includes('<') ? from.slice(0, from.indexOf('<')).replace(/^"|"$/g, '').trim() || sourceKey(from) : from;
}
export function groupMessages(items: ReviewItem[]) {
  const groups = new Map<string, { key: string; name: string; items: ReviewItem[] }>();
  for (const item of items) {
    const key = sourceKey(item.from);
    const group = groups.get(key) ?? { key, name: sourceName(item.from), items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
