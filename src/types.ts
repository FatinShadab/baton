export type PanelMessage = { type: 'routeTask'; text: string };
export type ExtensionMessage = { type: 'received'; text: string };

export function isPanelMessage(message: unknown): message is PanelMessage {
  return typeof message === 'object' && message !== null
    && 'type' in message && message.type === 'routeTask'
    && 'text' in message && typeof message.text === 'string';
}
