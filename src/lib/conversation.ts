import type { ChatMessage } from './openrouter';

export type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
  script?: string;
};

const MAX_TURNS = 12;

export function appendTurn(turns: ConversationTurn[], turn: ConversationTurn): ConversationTurn[] {
  const next = [...turns, turn];
  return next.length > MAX_TURNS ? next.slice(-MAX_TURNS) : next;
}

export function buildScriptMessages(
  systemPrompt: string,
  turns: ConversationTurn[],
  sceneSummary: string,
  userPrompt: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const turn of turns) {
    if (turn.role === 'assistant' && turn.script) {
      messages.push({
        role: 'assistant',
        content: `${turn.content}\n\n[Executed script]\n${turn.script.slice(0, 2000)}${turn.script.length > 2000 ? '\n…' : ''}`,
      });
    } else {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  messages.push({
    role: 'user',
    content: `Current scene: ${sceneSummary}\n\nUser request: ${userPrompt}\n\nBuild on the existing scene unless the user asks to clear/reset.`,
  });

  return messages;
}
