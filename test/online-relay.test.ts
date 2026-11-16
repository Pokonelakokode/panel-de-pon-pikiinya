import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OnlineRelayManager, type OnlinePeer } from '../src/server/online-relay.ts';

function makeMockPeer(id: string): { peer: OnlinePeer; inbox: Array<Record<string, unknown>> } {
  const inbox: Array<Record<string, unknown>> = [];
  const peer: OnlinePeer = {
    id,
    name: id,
    role: 'host',
    send: (payload) => {
      inbox.push(payload);
    },
  };
  return { peer, inbox };
}

describe('OnlineRelayManager (Host/Client Relay)', () => {
  it('supports host -> join -> start -> sync -> attack -> gameover -> rematch flow', () => {
    const relay = new OnlineRelayManager();
    const host = makeMockPeer('h1');
    const guest = makeMockPeer('g1');

    // 1. Host creates room
    relay.handleMessage(host.peer, {
      t: 'net_host',
      game: 'pikiinya',
      name: 'LipHost',
      options: { cols: 8 },
    });
    assert.equal(host.inbox.length, 1);
    assert.equal(host.inbox[0].t, 'net_hosted');
    const code = String(host.inbox[0].code);
    assert.equal(code.length, 4);
    assert.equal(host.inbox[0].game, 'pikiinya');

    // 2. Guest joins room
    relay.handleMessage(guest.peer, {
      t: 'net_join',
      code,
      name: 'EliasGuest',
    });
    assert.equal(guest.inbox[0].t, 'net_joined');
    assert.equal(guest.inbox[0].hostName, 'LipHost');
    assert.deepEqual(guest.inbox[0].options, { cols: 8 });
    assert.equal(host.inbox[1].t, 'net_peer_joined');
    assert.equal(host.inbox[1].peerName, 'EliasGuest');

    // 3. Non-host cannot start
    relay.handleMessage(guest.peer, { t: 'net_start' });
    assert.equal(guest.inbox[1].t, 'net_error');
    assert.equal(guest.inbox[1].code, 'NOT_HOST');

    // 4. Host starts match
    relay.handleMessage(host.peer, { t: 'net_start', options: { cols: 10 } });
    const hostStart = host.inbox[2];
    const guestStart = guest.inbox[2];
    assert.equal(hostStart.t, 'net_started');
    assert.equal(guestStart.t, 'net_started');
    assert.equal(hostStart.seed, guestStart.seed);
    assert.deepEqual(guestStart.options, { cols: 10 });

    // 5. Sync & Attack relay strictly to opponent
    const hostInboxBefore = host.inbox.length;
    const guestInboxBefore = guest.inbox.length;
    relay.handleMessage(host.peer, { t: 'net_sync', state: { score: 1200 } });
    assert.equal(host.inbox.length, hostInboxBefore);
    assert.equal(guest.inbox.length, guestInboxBefore + 1);
    assert.equal(guest.inbox[guestInboxBefore].t, 'net_sync');
    assert.deepEqual(guest.inbox[guestInboxBefore].state, { score: 1200 });

    relay.handleMessage(guest.peer, { t: 'net_attack', attack: { blocks: 6, chain: 2 } });
    assert.equal(host.inbox.length, hostInboxBefore + 1);
    assert.equal(host.inbox[hostInboxBefore].t, 'net_attack');
    assert.deepEqual(host.inbox[hostInboxBefore].attack, { blocks: 6, chain: 2 });

    // 6. Game over & Rematch
    relay.handleMessage(guest.peer, { t: 'net_gameover', summary: { score: 500 } });
    assert.equal(host.inbox[host.inbox.length - 1].t, 'net_gameover');
    assert.equal(host.inbox[host.inbox.length - 1].loser, 'client');
    assert.equal(guest.inbox[guest.inbox.length - 1].t, 'net_gameover');

    relay.handleMessage(host.peer, { t: 'net_rematch' });
    assert.equal(guest.inbox[guest.inbox.length - 1].t, 'net_rematch_wait');
    relay.handleMessage(guest.peer, { t: 'net_rematch' });
    assert.equal(host.inbox[host.inbox.length - 1].t, 'net_started');
    assert.equal(guest.inbox[guest.inbox.length - 1].t, 'net_started');
  });

  it('rejects full or unknown rooms and notifies peer on leave', () => {
    const relay = new OnlineRelayManager();
    const host = makeMockPeer('h1');
    const guest1 = makeMockPeer('g1');
    const guest2 = makeMockPeer('g2');

    relay.handleMessage(guest1.peer, { t: 'net_join', code: 'ZZZZ', name: 'G1' });
    assert.equal(guest1.inbox[0].t, 'net_error');
    assert.equal(guest1.inbox[0].code, 'NOT_FOUND');

    relay.handleMessage(host.peer, { t: 'net_host', game: 'pdp', name: 'H1' });
    const code = String(host.inbox[0].code);

    relay.handleMessage(guest1.peer, { t: 'net_join', code, name: 'G1' });
    relay.handleMessage(guest2.peer, { t: 'net_join', code, name: 'G2' });
    assert.equal(guest2.inbox[0].t, 'net_error');
    assert.equal(guest2.inbox[0].code, 'ROOM_FULL');

    relay.leave(host.peer);
    assert.equal(guest1.inbox[guest1.inbox.length - 1].t, 'net_peer_left');
    assert.equal(guest1.inbox[guest1.inbox.length - 1].role, 'host');
    assert.equal(relay.rooms.has(code), false);
  });
});
