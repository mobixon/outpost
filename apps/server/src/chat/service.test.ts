import { describe, expect, it } from 'vitest';
import { createChat } from './service.js';

function setUp(allowed = true) {
  const sent: string[] = [];
  const chat = createChat(
    async (_serverId, command) => {
      sent.push(command);
      return '';
    },
    async () => allowed,
  );
  return { chat, sent };
}

describe('chat', () => {
  it('tells one player with tellraw, and everyone with @a', async () => {
    const { chat, sent } = setUp();
    await chat.tell('s1', 'Steve', '&6Hello &lthere');
    await chat.broadcast('s1', 'Hi all');
    expect(sent).toEqual([
      'tellraw Steve ["",{"text":"Hello ","color":"gold"},{"text":"there","color":"gold","bold":true}]',
      'tellraw @a ["",{"text":"Hi all"}]',
    ]);
  });

  it('sends several lines as one command', async () => {
    const { chat, sent } = setUp();
    await chat.tell('s1', 'Steve', ['one', '&aTwo', 'three']);
    expect(sent).toEqual([
      'tellraw Steve ["",{"text":"one"},{"text":"\\n"},{"text":"Two","color":"green"},{"text":"\\n"},{"text":"three"}]',
    ]);
    await chat.broadcast('s1', []);
    expect(sent).toHaveLength(1);
  });

  it('does not let a name or a message change the command', async () => {
    const { chat, sent } = setUp();
    await expect(chat.tell('s1', 'Steve @a', 'x')).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_player',
    });
    await expect(chat.tell('s1', 'Steve', 'x'.repeat(2000))).rejects.toMatchObject({
      statusCode: 400,
      code: 'message_too_long',
    });
    expect(sent).toEqual([]);
    await chat.tell('s1', 'Steve', '"] tellraw @a {');
    expect(sent[0]).toContain(String.raw`\"] tellraw @a {`);
  });

  it('needs the capability', async () => {
    const { chat, sent } = setUp(false);
    await expect(chat.broadcast('s1', 'x')).rejects.toMatchObject({ statusCode: 409 });
    expect(sent).toEqual([]);
  });
});
