import { type OnlinePlayer, type PlayerFlag, type RoomSummary, withFlag } from '@open-northland/net-protocol';
import { compareLabels } from '../../../../i18n/index.js';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE;
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR;
const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY;

/** The rooms a player can still join, and those whose game runs, each by the name it shows; the id
 *  only breaks a tie between alike names. An ended room, or one nobody is connected to, is left out. */
export function hallRooms(rooms: readonly RoomSummary[]): {
  readonly open: readonly RoomSummary[];
  readonly running: readonly RoomSummary[];
} {
  const compare = compareLabels();
  const sorted = rooms
    .filter((room) => room.members.length > 0)
    .sort((a, b) => compare(a.name, b.name) || a.id.localeCompare(b.id));
  return {
    open: sorted.filter((room) => room.state === 'lobby'),
    running: sorted.filter((room) => room.state === 'running'),
  };
}

/** Where an online player is, as the players list words it. */
export type PlayerWhereabouts =
  | { readonly kind: 'hall' }
  | { readonly kind: 'lobby' | 'playing'; readonly room: string };

export interface OnlineRow {
  readonly nick: string;
  readonly flag?: PlayerFlag;
  readonly self: boolean;
  readonly where: PlayerWhereabouts;
}

/** Everyone online, the player first, then those looking for a game, then by name. */
export function onlineRows(
  online: readonly OnlinePlayer[],
  rooms: readonly RoomSummary[],
  self: string,
): readonly OnlineRow[] {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const compare = compareLabels();
  const rows = online.map((player): OnlineRow => {
    const room = player.room === null ? undefined : byId.get(player.room);
    const where: PlayerWhereabouts =
      room === undefined
        ? { kind: 'hall' }
        : { kind: room.state === 'lobby' ? 'lobby' : 'playing', room: room.name };
    return { nick: player.nick, ...withFlag(player.flag), self: player.nick === self, where };
  });
  const rank = (row: OnlineRow): number => (row.self ? 0 : row.where.kind === 'hall' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || compare(a.nick, b.nick));
}

/** A running clock as `h:mm:ss`, or `m:ss` under an hour. */
export function formatPlayed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MS_PER_SECOND));
  const seconds = total % SECONDS_PER_MINUTE;
  const minutes = Math.floor(total / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const hours = Math.floor(total / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

/** How long ago `at` was, in the largest whole unit; null under a minute, which reads as "just now". */
export function formatAgo(at: number, now: number, tag: string): string | null {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MS_PER_MINUTE) return null;
  let format = relativeFormats.get(tag);
  if (format === undefined) {
    format = new Intl.RelativeTimeFormat(tag, { numeric: 'auto', style: 'long' });
    relativeFormats.set(tag, format);
  }
  if (elapsed < MS_PER_HOUR) return format.format(-Math.floor(elapsed / MS_PER_MINUTE), 'minute');
  if (elapsed < MS_PER_DAY) return format.format(-Math.floor(elapsed / MS_PER_HOUR), 'hour');
  return format.format(-Math.floor(elapsed / MS_PER_DAY), 'day');
}

const stampFormats = new Map<string, Intl.DateTimeFormat>();

/** A chat line's time: the clock alone for today's, the day and the clock for an older one. */
export function formatChatStamp(at: number, now: number, tag: string): string {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  const key = `${tag}:${sameDay}`;
  let format = stampFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(
      tag,
      sameDay
        ? { hour: '2-digit', minute: '2-digit' }
        : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' },
    );
    stampFormats.set(key, format);
  }
  return format.format(at);
}
