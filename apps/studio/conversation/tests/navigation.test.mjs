import test from 'node:test';
import assert from 'node:assert/strict';
import { recentConversations, conversationDay } from '../src/navigation.mjs';

test('recent conversations sort by actual last message without altering host history', () => {
  const chats = [
    { id: 'a', title: 'Primeiro', projectId: 'alpha', createdAt: '2026-10-07T10:00:00Z', messages: [{ text: 'Novo resultado', createdAt: '2026-10-09T12:00:00Z' }] },
    { id: 'b', title: 'Segundo', projectId: 'beta', createdAt: '2026-10-08T10:00:00Z', messages: [] },
    { id: 'c', title: 'Sem projeto', projectId: null, createdAt: '2026-10-09T10:00:00Z', messages: [] },
  ];
  const before = structuredClone(chats);
  assert.deepEqual(recentConversations(chats).map(value => value.id), ['a', 'c', 'b']);
  assert.deepEqual(recentConversations(chats, { projectId: 'beta' }).map(value => value.id), ['b']);
  assert.deepEqual(recentConversations(chats, { projectId: null }).map(value => value.id), ['c']);
  assert.deepEqual(recentConversations(chats, { query: 'resultado' }).map(value => value.id), ['a']);
  assert.equal(recentConversations(chats, { projectId: 'beta', query: 'resultado' }).length, 0);
  assert.deepEqual(chats, before);
});

test('day grouping uses local calendar days and tolerates missing timestamps', () => {
  const now = new Date(2026, 9, 9, 15);
  assert.equal(conversationDay(new Date(2026, 9, 9, 0), now), 'Hoje');
  assert.equal(conversationDay(new Date(2026, 9, 8, 23, 59), now), 'Ontem');
  assert.equal(conversationDay(new Date(2026, 9, 7, 23, 59), now), 'Mais antigas');
  assert.equal(conversationDay(undefined, now), 'Mais antigas');
});
