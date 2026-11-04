import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRealtimeClient, type RealtimeClient } from './client.js';
import {
  type AuctionUpdatedEvent,
  type ClientToServerEvents,
  REALTIME_PATH,
  type ServerToClientEvents,
  auctionRoom,
} from './events.js';

/** Zegar „serwera” w teście spieszy się o 5 s względem lokalnego. */
const SERVER_SKEW_MS = 5_000;

let http: HttpServer;
let server: Server<ClientToServerEvents, ServerToClientEvents>;
let url: string;
let client: RealtimeClient | undefined;
const subscribed: string[] = [];
const unsubscribed: string[] = [];
const viewed: string[] = [];
const unviewed: string[] = [];

beforeEach(async () => {
  subscribed.length = 0;
  unsubscribed.length = 0;
  viewed.length = 0;
  unviewed.length = 0;
  http = createServer();
  server = new Server(http, { path: REALTIME_PATH });
  server.on('connection', (socket) => {
    socket.on('auction:subscribe', (auctionId, ack) => {
      subscribed.push(auctionId);
      void socket.join(auctionRoom(auctionId));
      ack({ ok: true });
    });
    socket.on('auction:unsubscribe', (auctionId) => {
      unsubscribed.push(auctionId);
      void socket.leave(auctionRoom(auctionId));
    });
    socket.on('auction:view', (auctionId, ack) => {
      viewed.push(auctionId);
      ack({ ok: true, viewers: 4 });
    });
    socket.on('auction:unview', (auctionId) => {
      unviewed.push(auctionId);
    });
    socket.on('time:ping', (ack) => {
      ack({ serverTime: new Date(Date.now() + SERVER_SKEW_MS).toISOString() });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  client?.close();
  client = undefined;
  await server.close();
});

function connect(): RealtimeClient {
  client = createRealtimeClient({
    url,
    withCredentials: false,
    clockSamples: 3,
    // Szybki reconnect w testach.
    socketFactory: (target, options) =>
      io(target, { ...options, reconnectionDelay: 50, reconnectionDelayMax: 100 }),
  });
  return client;
}

function update(auctionId: string, bidCount: number): AuctionUpdatedEvent {
  return {
    auctionId,
    version: bidCount,
    status: 'ACTIVE',
    currency: 'PLN',
    currentPrice: 1_000 + bidCount,
    bidCount,
    leader: { publicName: 'k***a' },
    endsAt: new Date().toISOString(),
    reserveStatus: 'NONE',
    minimumNextBid: 1_050,
    buyNowAvailable: false,
    serverTime: new Date().toISOString(),
  };
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Nie doczekano się warunku');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('createRealtimeClient', () => {
  it('subskrypcja aukcji łączy leniwie i dostarcza tylko zdarzenia tej aukcji', async () => {
    const realtime = connect();
    expect(realtime.status).toBe('idle');
    const received: AuctionUpdatedEvent[] = [];
    realtime.subscribeAuction('a', { onUpdated: (event) => received.push(event) });
    await waitFor(() => subscribed.includes('a'));
    expect(realtime.status).toBe('connected');

    server.to(auctionRoom('b')).emit('auction.updated', update('b', 1));
    server.to(auctionRoom('a')).emit('auction.updated', update('a', 2));
    await waitFor(() => received.length === 1);
    expect(received.map((event) => event.auctionId)).toEqual(['a']);
  });

  it('licznik odwołań: odsubskrybowanie na serwerze dopiero po ostatnim handlerze', async () => {
    const realtime = connect();
    const first: number[] = [];
    const second: number[] = [];
    const stopFirst = realtime.subscribeAuction('a', {
      onUpdated: (event) => first.push(event.bidCount),
    });
    const stopSecond = realtime.subscribeAuction('a', {
      onUpdated: (event) => second.push(event.bidCount),
    });
    await waitFor(() => subscribed.length === 1);

    stopFirst();
    server.to(auctionRoom('a')).emit('auction.updated', update('a', 3));
    await waitFor(() => second.length === 1);
    expect(first).toEqual([]);
    expect(unsubscribed).toEqual([]);

    stopSecond();
    await waitFor(() => unsubscribed.length === 1);
    expect(unsubscribed).toEqual(['a']);
  });

  it('reconnect: ponowna subskrypcja aukcji i odświeżenie stanu', async () => {
    const realtime = connect();
    const received: number[] = [];
    let resyncs = 0;
    realtime.onReconnect(() => {
      resyncs += 1;
    });
    realtime.subscribeAuction('a', { onUpdated: (event) => received.push(event.bidCount) });
    await waitFor(() => subscribed.length === 1);

    // Serwer zamyka połączenia (wyłączanie instancji przy wdrożeniu): klient wraca sam
    // i subskrybuje ponownie.
    server.disconnectSockets();
    await waitFor(() => subscribed.length === 2 && resyncs === 1);
    server.to(auctionRoom('a')).emit('auction.updated', update('a', 7));
    await waitFor(() => received.length === 1);
    expect(received).toEqual([7]);
    expect(realtime.status).toBe('connected');
  });

  it('oglądanie aukcji (F-63): liczba z potwierdzenia, zmiany na żywo, ponownie po reconnect', async () => {
    const realtime = connect();
    const counts: number[] = [];
    const stop = realtime.viewAuction('a', (count) => counts.push(count));
    await waitFor(() => counts.length === 1);
    expect(subscribed).toEqual(['a']);
    expect(viewed).toEqual(['a']);
    expect(counts).toEqual([4]);

    server.to(auctionRoom('a')).emit('auction.viewers', {
      auctionId: 'a',
      count: 7,
      serverTime: new Date().toISOString(),
    });
    await waitFor(() => counts.length === 2);
    expect(counts.at(-1)).toBe(7);

    // Drugi widok tej samej aukcji dostaje znaną liczbę od razu, bez drugiego zgłoszenia.
    const second: number[] = [];
    const stopSecond = realtime.viewAuction('a', (count) => second.push(count));
    expect(second).toEqual([7]);

    server.disconnectSockets();
    await waitFor(() => viewed.length === 2);

    stopSecond();
    stop();
    await waitFor(() => unviewed.length === 1 && unsubscribed.length === 1);
    expect(unviewed).toEqual(['a']);
  });

  it('zegar: przesunięcie z pingów i czas serwera', async () => {
    const realtime = connect();
    const offsets: number[] = [];
    realtime.onClockOffset((offset) => offsets.push(offset));
    realtime.connect();
    await waitFor(() => offsets.length === 1);
    expect(Math.abs((realtime.clockOffset() ?? 0) - SERVER_SKEW_MS)).toBeLessThan(100);
    expect(Math.abs(realtime.serverNow() - (Date.now() + SERVER_SKEW_MS))).toBeLessThan(100);
  });

  it('zdarzenia użytkownika i statusy połączenia', async () => {
    const realtime = connect();
    const statuses: string[] = [];
    realtime.onStatus((status) => statuses.push(status));
    const outbid: string[] = [];
    realtime.onUserEvents({ onOutbid: (event) => outbid.push(event.auctionId) });
    await waitFor(() => realtime.status === 'connected');
    server.emit('user.outbid', {
      auctionId: 'a',
      currency: 'PLN',
      currentPrice: 2_000,
      minimumNextBid: 2_100,
      endsAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
    });
    await waitFor(() => outbid.length === 1);
    realtime.close();
    expect(statuses).toEqual(['connecting', 'connected', 'idle']);
  });

  it('wiadomości i odczyty rozmów (F-29)', async () => {
    const realtime = connect();
    const received: string[] = [];
    realtime.onUserEvents({
      onMessage: (event) => received.push(`message:${event.messageId}:${event.unreadCount}`),
      onConversationRead: (event) => received.push(`read:${event.conversationId}`),
    });
    await waitFor(() => realtime.status === 'connected');
    const serverTime = new Date().toISOString();
    server.emit('message.new', {
      conversationId: 'c',
      messageId: 'm',
      senderId: 'u',
      createdAt: serverTime,
      unreadCount: 2,
      serverTime,
    });
    server.emit('conversation.read', {
      conversationId: 'c',
      readerId: 'u',
      readAt: serverTime,
      unreadCount: 0,
      serverTime,
    });
    await waitFor(() => received.length === 2);
    realtime.close();
    expect(received).toEqual(['message:m:2', 'read:c']);
  });
});
