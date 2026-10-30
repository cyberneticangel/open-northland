import { PROTOCOL_VERSION } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { HALL_CHAT_BURST } from '../../../src/relay/hall/hall.js';
import { HALL_RECORD_VERSION } from '../../../src/relay/hall/record.js';
import { HALL_ARRIVAL_MS, HALL_REFRESH_MS, SEEN_AFTER_MS } from '../../../src/relay/relay.js';
import {
  SEATS,
  SETTINGS,
  STAGE_EPOCH_MS,
  stage,
  startedRoom,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from '../../support/message-stage.js';

/** A client outside a room hears the rooms, who is online and the server chat; one inside does not. */
describe('relay hall', () => {
  it('shows an arriving client the whole hall, then only what changed', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    s.advance(1);
    expect(a.last('rooms')?.rooms).toEqual([]);
    expect(a.last('presence')?.online).toEqual([{ nick: 'Ania', room: null }]);
    expect(a.last('hallChatHistory')?.lines).toEqual([]);

    const b = s.introduce(TOKEN_B, 'Bartek');
    s.advance(HALL_REFRESH_MS);
    expect(a.last('presence')?.online.map((player) => player.nick)).toEqual(['Ania', 'Bartek']);
    const heard = a.sent.length;
    s.advance(HALL_REFRESH_MS);
    expect(a.sent.length).toBe(heard);

    b.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    s.advance(HALL_REFRESH_MS);
    expect(a.last('rooms')?.rooms).toMatchObject([
      { name: 'Zatoka', state: 'lobby', members: ['Bartek'], world: SETTINGS.world, playedMs: null },
    ]);
    expect(a.last('presence')?.online).toContainEqual({ nick: 'Bartek', room: b.last('room')?.room.id });
    expect(b.of('presence')).toHaveLength(1);
  });

  it('tells two connections of one nick apart, so each knows its own row and lines', () => {
    const s = stage();
    s.introduce(TOKEN_A, 'Ania');
    const twin = s.introduce(TOKEN_B, 'ANIA');
    expect(twin.last('welcome')?.nick).toBe('ANIA2');
    s.advance(1);
    expect(twin.last('presence')?.online.map((player) => player.nick)).toEqual(['Ania', 'ANIA2']);
    twin.send({ kind: 'hallChat', text: 'to ja' });
    expect(twin.last('hallChat')?.from).toBe('ANIA2');
  });

  it('holds the nick of a player who dropped out of a game for their return', () => {
    const s = startedRoom();
    s.relay.disconnect(s.b.handle);
    const stranger = s.introduce(TOKEN_C, 'Bartek');
    expect(stranger.last('welcome')?.nick).toBe('Bartek2');
    const back = s.introduce('token-b-0123456789ab', 'Bartek');
    expect(back.last('welcome')?.nick).toBe('Bartek');
  });

  it('sends a change back to an earlier list to a client that arrived in between', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    s.advance(HALL_REFRESH_MS);
    const b = s.introduce(TOKEN_B, 'Bartek');
    b.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const c = s.introduce(TOKEN_C, 'Celina');
    s.advance(HALL_ARRIVAL_MS);
    expect(c.last('rooms')?.rooms).toHaveLength(1);
    b.send({ kind: 'leaveRoom' });
    s.advance(HALL_REFRESH_MS);
    expect(c.last('rooms')?.rooms).toEqual([]);
    expect(a.last('rooms')?.rooms).toEqual([]);
  });

  it('broadcasts the server chat to the hall alone, and replays it to whoever arrives', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    s.advance(1);
    b.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    a.send({ kind: 'hallChat', text: 'ktoś gra?' });
    const line = { from: 'Ania', text: 'ktoś gra?', at: STAGE_EPOCH_MS + 1 };
    expect(a.last('hallChat')).toEqual({ kind: 'hallChat', ...line });
    expect(b.of('hallChat')).toEqual([]);

    b.send({ kind: 'hallChat', text: 'ja' });
    expect(b.last('rejected')?.reason).toEqual({ code: 'alreadyInRoom' });
    b.send({ kind: 'leaveRoom' });
    s.advance(HALL_ARRIVAL_MS);
    expect(b.last('hallChatHistory')).toEqual({ kind: 'hallChatHistory', lines: [line], replaces: false });
  });

  it('shows the flag a player said hello with beside their nick, in the hall and in a room', () => {
    const s = stage();
    const a = s.peer();
    a.send({ kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN_A, nick: 'Ania', flag: 'PL' });
    s.advance(1);
    expect(a.last('presence')?.online).toEqual([{ nick: 'Ania', flag: 'PL', room: null }]);
    a.send({ kind: 'hallChat', text: 'cześć' });
    expect(a.last('hallChat')).toMatchObject({ from: 'Ania', flag: 'PL' });
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    expect(a.last('room')?.room.members).toMatchObject([{ nick: 'Ania', flag: 'PL' }]);
    a.send({ kind: 'chat', text: 'gotowi?' });
    expect(a.last('chat')).toMatchObject({ from: 'Ania', flag: 'PL' });
  });

  it('keeps the flag a member joined its game with, none included, when it returns with another', () => {
    const s = startedRoom();
    const watcher = s.introduce(TOKEN_C, 'Celina');
    s.relay.disconnect(s.a.handle);
    const back = s.peer();
    back.send({ kind: 'hello', protocol: PROTOCOL_VERSION, token: TOKEN_A, nick: 'Ania', flag: 'PL' });
    s.advance(HALL_REFRESH_MS);
    expect(back.last('room')?.room.members.find((member) => member.nick === 'Ania')).not.toHaveProperty(
      'flag',
    );
    expect(watcher.last('presence')?.online.find((player) => player.nick === 'Ania')).not.toHaveProperty(
      'flag',
    );
  });

  it('replays to a player back from a room only what changed while they were away', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'hallChat', text: 'ktoś gra?' });
    s.advance(1);
    for (let visit = 0; visit < 3; visit++) {
      a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
      a.send({ kind: 'leaveRoom' });
      s.advance(HALL_ARRIVAL_MS);
    }
    expect(a.of('hallChatHistory')).toHaveLength(1);
    expect(a.of('rooms')).toHaveLength(1);
    expect(a.of('presence')).toHaveLength(1);
  });

  it('remembers a player whose link was replaced by the time they were online in all', () => {
    const s = stage();
    s.introduce(TOKEN_A, 'Ania');
    s.advance(SEEN_AFTER_MS);
    const again = s.introduce(TOKEN_A, 'Ania');
    s.relay.disconnect(again.handle);
    expect(s.relay.hallRecord().seen.map((player) => player.nick)).toEqual(['Ania']);
  });

  it('shares one chat allowance among the connections of one address', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania', '203.0.113.7');
    const twin = s.introduce(TOKEN_B, 'Bartek', '203.0.113.7');
    const other = s.introduce(TOKEN_C, 'Celina', '198.51.100.2');
    s.advance(1);
    for (let i = 0; i < HALL_CHAT_BURST; i++) a.send({ kind: 'hallChat', text: `${i}` });
    twin.send({ kind: 'hallChat', text: 'jeszcze' });
    expect(twin.last('rejected')?.reason).toEqual({ code: 'retryTooSoon' });
    other.send({ kind: 'hallChat', text: 'ja mogę' });
    expect(other.last('hallChat')?.from).toBe('Celina');
    s.relay.disconnect(twin.handle);
    const again = s.introduce('token-d-0123456789ab', 'Dawid', '203.0.113.7');
    again.send({ kind: 'hallChat', text: 'nowe połączenie' });
    expect(again.last('rejected')?.reason).toEqual({ code: 'retryTooSoon' });
  });

  it('takes no nick that shows the same as one online', () => {
    const s = stage();
    s.introduce(TOKEN_A, 'Ania');
    expect(s.introduce(TOKEN_B, 'Ania\uFE0F').last('welcome')?.nick).toBe('Ania\uFE0F2');
    expect(s.introduce(TOKEN_C, 'Ani\u2800a').last('welcome')?.nick).toBe('Ani\u2800a3');
  });

  it('refuses a flood of server chat lines', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    s.advance(1);
    for (let i = 0; i <= HALL_CHAT_BURST; i++) a.send({ kind: 'hallChat', text: `${i}` });
    expect(a.of('hallChat')).toHaveLength(HALL_CHAT_BURST);
    expect(a.last('rejected')).toEqual({
      kind: 'rejected',
      of: 'hallChat',
      reason: { code: 'retryTooSoon' },
    });
  });

  it('remembers who left, and starts from the hall the host kept', () => {
    let changes = 0;
    const kept = {
      version: HALL_RECORD_VERSION,
      chat: [{ from: 'Celina', text: 'dobranoc', at: STAGE_EPOCH_MS - 1000 }],
      seen: [{ nick: 'Celina', at: STAGE_EPOCH_MS - 1000 }],
    } as const;
    const s = stage(true, undefined, { hall: kept, hallChanged: () => changes++ });
    const passing = s.introduce(TOKEN_C, 'Dawid');
    s.relay.disconnect(passing.handle);
    const b = s.introduce(TOKEN_B, 'Bartek');
    s.advance(SEEN_AFTER_MS);
    s.relay.disconnect(b.handle);
    const a = s.introduce(TOKEN_A, 'Ania');
    s.advance(HALL_ARRIVAL_MS);
    expect(changes).toBe(1);
    expect(a.last('hallChatHistory')?.lines).toEqual(kept.chat);
    expect(a.last('presence')?.recent).toEqual([
      { nick: 'Bartek', at: STAGE_EPOCH_MS + SEEN_AFTER_MS },
      { nick: 'Celina', at: STAGE_EPOCH_MS - 1000 },
    ]);
    expect(s.relay.hallRecord().seen.map((player) => player.nick)).toEqual(['Celina', 'Bartek']);
    s.advance(SEEN_AFTER_MS);
    expect(s.relay.hallRecord().seen.map((player) => player.nick)).toEqual(['Celina', 'Bartek', 'Ania']);
  });
});
