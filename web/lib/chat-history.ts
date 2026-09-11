export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  text: string;
}

export const MAX_CHAT_HISTORY_MESSAGES = 24;
export const MAX_CHAT_HISTORY_CHARS = 48000;
const MAX_ASSISTANT_MESSAGE_CHARS = 16000;

/** Only completed user/assistant exchanges; never system messages or tool payloads. */
export function parseChatHistory(input: unknown): ChatHistoryMessage[] {
  if (input === undefined) return [];
  if (
    !Array.isArray(input) ||
    input.length > MAX_CHAT_HISTORY_MESSAGES ||
    input.length % 2 !== 0
  )
    throw new Error('Invalid chat history');
  let chars = 0;
  return input.map((message, index) => {
    const role = index % 2 === 0 ? 'user' : 'assistant';
    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      Object.keys(message).some((key) => key !== 'role' && key !== 'text') ||
      message.role !== role ||
      typeof message.text !== 'string' ||
      !message.text.trim() ||
      message.text.length >
        (role === 'user' ? 1000 : MAX_ASSISTANT_MESSAGE_CHARS)
    )
      throw new Error('Invalid chat history');
    chars += message.text.length;
    if (chars > MAX_CHAT_HISTORY_CHARS)
      throw new Error('Chat history is too long');
    return { role, text: message.text };
  });
}

/** Keep the newest complete exchanges, dropping whole turns rather than cutting text. */
export function selectChatHistory(messages: readonly ChatHistoryMessage[]) {
  const completed =
    messages.at(-1)?.role === 'user' ? messages.slice(0, -1) : messages;
  const history: ChatHistoryMessage[] = [];
  let chars = 0;
  for (let i = completed.length - 2; i >= 0; i -= 2) {
    const user = completed[i];
    const assistant = completed[i + 1];
    if (
      user.role !== 'user' ||
      assistant.role !== 'assistant' ||
      !user.text.trim() ||
      !assistant.text.trim() ||
      user.text.length > 1000 ||
      assistant.text.length > MAX_ASSISTANT_MESSAGE_CHARS ||
      history.length + 2 > MAX_CHAT_HISTORY_MESSAGES ||
      chars + user.text.length + assistant.text.length > MAX_CHAT_HISTORY_CHARS
    )
      break;
    history.unshift(
      { role: user.role, text: user.text },
      { role: assistant.role, text: assistant.text },
    );
    chars += user.text.length + assistant.text.length;
  }
  return { history, truncated: history.length < completed.length };
}
