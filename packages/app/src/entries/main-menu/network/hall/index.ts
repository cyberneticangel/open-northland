import type { SessionWorld } from '@open-northland/lockstep';
import type { RelayClientView } from '@open-northland/net-client';
import { type HallChatLine, MAX_CHAT_LENGTH, type RoomSummary } from '@open-northland/net-protocol';
import { quietTextField } from '../../../../hud/dom/parts/text-field.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../../i18n/index.js';
import { node } from '../../dom.js';
import { nickWithFlag } from '../flags/catalog.js';
import { button } from '../parts.js';
import { formatAgo, formatChatStamp, formatPlayed, hallRooms, type OnlineRow, onlineRows } from './model.js';

/** Chat lines kept on screen; the relay replays at most as many. */
const CHAT_LOG_LINES = 200;
/** A log scrolled this close to its end follows new lines. */
const FOLLOW_SLACK_PX = 32;
/** How often running clocks and "seen ago" times are rewritten. */
const TICK_MS = 1000;

export type HallClient = Pick<
  RelayClientView,
  'nick' | 'rooms' | 'online' | 'recent' | 'hallChat' | 'sayInHall'
>;

export interface HallDeps {
  /** The connected client, null while there is none. */
  readonly client: () => HallClient | null;
  readonly worldTitle: (world: SessionWorld) => string;
  readonly join: (roomId: string) => void;
}

/**
 * What a connected player sees outside a room: the games on the server, who is on it, and its chat.
 * Each part repaints from the client's state when the relay's matching message arrives.
 */
export function networkHall(deps: HallDeps) {
  const copy = messages().network;
  let enabled = false;
  const joins: HTMLButtonElement[] = [];
  /** Running rooms' clocks, extrapolated from the summary since it arrived. */
  let clocks: { readonly time: HTMLElement; readonly playedMs: number }[] = [];
  let roomsAt = performance.now();
  /** The list `roomsAt` dates; the client holds a new array per `rooms` message. */
  let roomsShown: readonly RoomSummary[] | null = null;
  let ago: { readonly time: HTMLElement; readonly at: number }[] = [];

  const openList = node('div', 'network-menu__rooms');
  const runningList = node('div', 'network-menu__rooms');
  const openCount = node('span', 'network-hall__count');
  const runningCount = node('span', 'network-hall__count');
  const rooms = node('section', 'network-menu__room-list network-hall__games');
  rooms.tabIndex = -1;
  const roomsHead = node('header', 'network-menu__section-head');
  roomsHead.append(node('h2', '', copy.rooms));
  rooms.append(
    roomsHead,
    subhead(copy.openRooms, openCount),
    openList,
    subhead(copy.runningGames, runningCount),
    runningList,
  );
  openList.append(node('p', 'network-menu__muted', copy.loadingRooms));

  const onlineCount = node('span', 'network-hall__count');
  const recentCount = node('span', 'network-hall__count');
  const onlineList = node('ul', 'network-hall__people');
  const recentList = node('ul', 'network-hall__people network-hall__people--recent');
  const recentHead = subhead(copy.recentPlayers, recentCount);
  const players = node('section', 'network-hall__card network-hall__players');
  players.append(
    node('h2', '', copy.players),
    subhead(copy.onlinePlayers, onlineCount),
    onlineList,
    recentHead,
    recentList,
  );

  const chat = node('section', 'network-hall__card network-hall__chat');
  const chatHead = node('header', 'network-hall__chat-head');
  chatHead.append(node('h2', '', copy.hallChat), node('p', 'network-menu__muted', copy.hallChatHint));
  const log = node('div', 'network-hall__chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', copy.hallChat);
  log.tabIndex = 0;
  const chatEmpty = node('p', 'network-hall__chat-empty', copy.hallChatEmpty);
  const form = node('form', 'network-hall__chat-form');
  const input = quietTextField(node('input'));
  input.type = 'text';
  input.maxLength = MAX_CHAT_LENGTH;
  input.placeholder = copy.hallChatPlaceholder;
  input.setAttribute('aria-label', copy.hallChatPlaceholder);
  const send = button(copy.send, () => undefined);
  send.type = 'submit';
  form.append(input, send);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!enabled || text === '') return;
    deps.client()?.sayInHall(text);
    input.value = '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing && event.key === 'Enter') event.preventDefault();
  });
  chat.append(chatHead, chatEmpty, log, form);

  const tag = bcp47Tag();
  const chatRow = (line: HallChatLine, now: number, nick: string): HTMLElement => {
    const row = node('p', line.from === nick ? 'is-own' : '');
    if (line.from !== nick && mentions(line.text, nick)) row.classList.add('is-mention');
    const time = node('time', 'network-hall__chat-time', formatChatStamp(line.at, now, tag));
    time.setAttribute('datetime', new Date(line.at).toISOString());
    row.append(time, nickWithFlag('strong', '', line.from, line.flag), node('span', '', line.text));
    return row;
  };

  const roomRow = (room: RoomSummary): HTMLElement => {
    const row = node('div', 'network-menu__room-row network-hall__room');
    const main = node('div', 'network-hall__room-main');
    const meta = node(
      'p',
      'network-hall__room-meta',
      `${deps.worldTitle(room.world)} · ${formatMessage(copy.roomCapacity, {
        members: formatMessage(pluralForm(room.members.length, copy.members, tag), {
          count: room.members.length,
        }),
        seats: room.seats,
      })}`,
    );
    const nicks = node('ul', 'network-hall__nicks');
    nicks.append(...room.members.map((nick) => node('li', '', nick)));
    main.append(node('strong', 'network-hall__room-name', room.name), meta, nicks);
    row.append(main);
    if (room.state === 'lobby') {
      const join = button(copy.join, () => {
        if (enabled) deps.join(room.id);
      });
      join.disabled = !enabled;
      joins.push(join);
      row.append(join);
    } else if (room.playedMs === null) {
      row.append(node('span', 'network-hall__badge', copy.gameLoading));
    } else {
      const clock = node('div', 'network-hall__clock');
      const time = node('time', '', formatPlayed(room.playedMs + performance.now() - roomsAt));
      clock.append(node('span', '', copy.playedFor), time);
      clocks.push({ time, playedMs: room.playedMs });
      row.append(clock);
    }
    return row;
  };

  const whereText = (row: OnlineRow): string => {
    switch (row.where.kind) {
      case 'hall':
        return copy.lookingForGame;
      case 'lobby':
        return formatMessage(copy.inRoom, { room: row.where.room });
      case 'playing':
        return formatMessage(copy.playingIn, { room: row.where.room });
    }
  };

  const tick = (): void => {
    const sinceRooms = performance.now() - roomsAt;
    for (const clock of clocks) clock.time.textContent = formatPlayed(clock.playedMs + sinceRooms);
    const now = Date.now();
    for (const entry of ago) {
      const text = formatAgo(entry.at, now, tag) ?? copy.justNow;
      if (entry.time.textContent !== text) entry.time.textContent = text;
    }
  };
  const timer = setInterval(tick, TICK_MS);

  const showPresence = (): void => {
    const client = deps.client();
    if (client === null) return;
    const now = Date.now();
    const online = onlineRows(client.online, client.rooms, client.nick);
    onlineCount.textContent = String(online.length);
    onlineList.replaceChildren(
      ...online.map((row) => {
        const item = node('li', `is-online is-${row.where.kind}${row.self ? ' is-self' : ''}`);
        const name = nickWithFlag('span', 'network-hall__nick', row.nick, row.flag);
        if (row.self) name.append(node('em', '', copy.you));
        item.append(
          node('i', 'network-hall__dot'),
          name,
          node('span', 'network-hall__where', whereText(row)),
        );
        return item;
      }),
    );
    ago = [];
    recentCount.textContent = String(client.recent.length);
    recentList.replaceChildren(
      ...client.recent.map((player) => {
        const item = node('li', 'is-away');
        const time = node('time', 'network-hall__where', formatAgo(player.at, now, tag) ?? copy.justNow);
        time.setAttribute('datetime', new Date(player.at).toISOString());
        ago.push({ time, at: player.at });
        item.append(node('i', 'network-hall__dot'), node('span', 'network-hall__nick', player.nick), time);
        return item;
      }),
    );
    if (client.recent.length === 0) recentList.append(node('li', 'network-hall__none', copy.noRecentPlayers));
  };

  return {
    rooms,
    players,
    chat,
    /** The room list changed, or the names its maps show. */
    showRooms(): void {
      const client = deps.client();
      if (client === null) return;
      const { open, running } = hallRooms(client.rooms);
      if (client.rooms !== roomsShown) {
        roomsShown = client.rooms;
        roomsAt = performance.now();
      }
      clocks = [];
      joins.length = 0;
      openCount.textContent = String(open.length);
      runningCount.textContent = String(running.length);
      openList.replaceChildren(...open.map(roomRow));
      if (open.length === 0) {
        const empty = node('div', 'network-menu__empty');
        empty.append(node('h3', '', copy.emptyTitle), node('p', '', copy.empty));
        openList.append(empty);
      }
      runningList.replaceChildren(...running.map(roomRow));
      if (running.length === 0) runningList.append(node('p', 'network-hall__none', copy.noRunningGames));
      // Whereabouts name rooms, so they follow the list.
      showPresence();
    },
    showPresence,
    /** The relay's whole chat, as it replays it to a player arriving outside a room. */
    showChat(): void {
      const client = deps.client();
      if (client === null) return;
      const now = Date.now();
      const lines = client.hallChat.slice(-CHAT_LOG_LINES);
      chatEmpty.hidden = lines.length > 0;
      log.replaceChildren(...lines.map((line) => chatRow(line, now, client.nick)));
      log.scrollTop = log.scrollHeight;
    },
    observeChat(line: HallChatLine): void {
      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < FOLLOW_SLACK_PX;
      chatEmpty.hidden = true;
      const nick = deps.client()?.nick ?? '';
      log.append(chatRow(line, Date.now(), nick));
      while (log.childElementCount > CHAT_LOG_LINES) log.firstElementChild?.remove();
      if (atEnd || line.from === nick) log.scrollTop = log.scrollHeight;
    },
    enable(on: boolean): void {
      enabled = on;
      input.disabled = !on;
      send.disabled = !on;
      for (const join of joins) join.disabled = !on;
    },
    dispose(): void {
      clearInterval(timer);
    },
  };
}

function subhead(text: string, count: HTMLElement): HTMLElement {
  const head = node('h3', 'network-hall__subhead', text);
  head.append(count);
  return head;
}

/** Whether `text` names `nick` as a word of its own, in any case. */
function mentions(text: string, nick: string): boolean {
  const at = text.toLocaleLowerCase().indexOf(nick.toLocaleLowerCase());
  if (at < 0) return false;
  const word = /[\p{L}\p{N}_]/u;
  const before = text[at - 1];
  const after = text[at + nick.length];
  return (before === undefined || !word.test(before)) && (after === undefined || !word.test(after));
}
