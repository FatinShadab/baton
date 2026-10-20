import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

class MockElement {
  public tagName: string;
  public id: string;
  public className: string = '';
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public style: Record<string, string> = {};
  public dataset: Record<string, string> = {};
  public hidden: boolean = false;
  public disabled: boolean = false;
  public checked: boolean = false;
  public value: string = '';
  public placeholder: string = '';
  public rows: number = 2;
  public attributes: Record<string, string> = {};
  public listeners: Record<string, Array<(evt: unknown) => void>> = {};
  private _textContent: string = '';

  constructor(tagName: string = 'div', id: string = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(val: string) {
    this.children = [];
    this._textContent = String(val);
  }

  get innerHTML(): string {
    return this.textContent;
  }

  set innerHTML(val: string) {
    this.textContent = val;
  }

  get classList() {
    return {
      add: (...classes: string[]) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const c of classes) set.add(c);
        this.className = [...set].join(' ');
      },
      remove: (...classes: string[]) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const c of classes) set.delete(c);
        this.className = [...set].join(' ');
      },
      toggle: (cls: string, force?: boolean) => {
        const set = new Set(this.className.split(/\s+/).filter(Boolean));
        const shouldAdd = force !== undefined ? force : !set.has(cls);
        if (shouldAdd) set.add(cls);
        else set.delete(cls);
        this.className = [...set].join(' ');
      },
      contains: (cls: string) => this.className.split(/\s+/).includes(cls),
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = String(value);
  }

  getAttribute(name: string): string | undefined {
    return this.attributes[name];
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  append(...items: Array<MockElement | string>): void {
    for (const item of items) {
      if (typeof item === 'string') {
        const textNode = new MockElement('#text');
        textNode.textContent = item;
        textNode.parentElement = this;
        this.children.push(textNode);
      } else if (item) {
        item.parentElement = this;
        this.children.push(item);
      }
    }
  }

  appendChild(child: MockElement): MockElement {
    if (child) {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }

  replaceChildren(...items: Array<MockElement | string>): void {
    this.children = [];
    this._textContent = '';
    this.append(...items);
  }

  remove(): void {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  addEventListener(event: string, fn: (evt: unknown) => void): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(evt: { type: string }): void {
    const handlers = this.listeners[evt.type] || [];
    for (const fn of handlers) fn(evt);
  }

  querySelector(sel: string): MockElement | null {
    const list = this.querySelectorAll(sel);
    return list[0] || null;
  }

  querySelectorAll(sel: string): MockElement[] {
    const results: MockElement[] = [];
    const walk = (node: MockElement) => {
      for (const child of node.children) {
        let match = true;

        // Check ID
        const idMatch = sel.match(/#([\w-]+)/);
        if (idMatch && child.id !== idMatch[1]) match = false;

        // Check Class
        const classMatches = sel.match(/\.([\w-]+)/g);
        if (classMatches) {
          for (const c of classMatches) {
            if (!child.classList.contains(c.slice(1))) {
              match = false;
              break;
            }
          }
        }

        // Check Tag
        const tagMatch = sel.match(/^([a-zA-Z0-9]+)/);
        if (tagMatch && child.tagName.toLowerCase() !== tagMatch[1].toLowerCase()) match = false;

        // Check Attribute [attr="val"]
        const attrMatches = [...sel.matchAll(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g)];
        if (attrMatches.length > 0) {
          for (const m of attrMatches) {
            const attrName = m[1];
            const attrVal = m[2];
            const val = attrName.startsWith('data-')
              ? child.dataset[attrName.slice(5).replace(/-([a-z])/g, (_, g) => g.toUpperCase())] ?? child.getAttribute(attrName)
              : child.getAttribute(attrName);
            if (attrVal !== undefined) {
              if (val !== attrVal) { match = false; break; }
            } else if (val === undefined) {
              match = false; break;
            }
          }
        }

        if (match) results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }

  focus(): void {}
  scrollTo(): void {}
}

class MockDocument {
  private readonly elements = new Map<string, MockElement>();

  constructor() {
    // Pre-seed known elements required by media/panel.js
    const ids = [
      'task-form',
      'task',
      'mic-btn',
      'handoff-fallback',
      'open-handoff-external',
      'toast-container',
      'finish-race-btn',
      'new-session-header-btn',
      'tip-close-btn',
      'auto-mode-card',
      'session-chip',
      'hero-state',
      'chat-messages',
      'context-preview',
      'context-preview-list',
      'context-preview-status',
      'context-preview-cancel',
      'context-preview-route',
      'toggle-research-btn',
      'close-research-btn',
      'refresh-research-btn',
      'research-sidebar',
      'chat-no-project-banner',
      'chat-open-project-btn',
      'complete-new-task-btn',
      'task-complete-banner',
      'dock-router-label',
      'router-indicator-pill',
      'agent-race-track',
      'race-track-steps',
      'race-track-lane',
      'race-track-segments-container',
      'race-track-nodes-container',
      'race-track-distance-badge',
      'close-race-track-btn',
      'toggle-track-btn',
      'floating-agents-sidebar',
      'floating-agents-list',
      'floating-add-agent-btn',
      'center-agent-indicator',
      'center-agent-avatar',
      'center-agent-name',
      'center-agent-model-pill',
      'center-agent-subtext',
      'center-agent-config-btn',
      'dock-active-agents',
      'agent-manager-modal',
      'close-agent-modal-btn',
      'agent-form',
      'agent-edit-id',
      'agent-name-input',
      'agent-models-input',
      'agent-submit-btn',
      'agent-cancel-edit-btn',
      'agent-count-badge',
      'saved-agents-list',
      'agent-session-modal',
      'close-agent-session-modal-btn',
      'session-agent-avatar',
      'session-agent-name',
      'session-agent-models',
      'session-agent-status-badge',
      'session-edit-agent-btn',
      'session-toggle-disable-btn',
    ];
    const hiddenIds = new Set([
      'finish-race-btn',
      'handoff-fallback',
      'chat-no-project-banner',
      'context-preview',
      'task-complete-banner',
      'agent-race-track',
      'agent-manager-modal',
      'agent-session-modal',
    ]);
    for (const id of ids) {
      const el = new MockElement('div', id);
      if (hiddenIds.has(id)) el.hidden = true;
      this.elements.set(id, el);
    }

    // Add submit button inside task-form
    const submitBtn = new MockElement('button');
    submitBtn.setAttribute('type', 'submit');
    this.elements.get('task-form')!.append(submitBtn);

    // Scroll area
    const scrollArea = new MockElement('div');
    scrollArea.className = 'chat-scroll-area';
    this.elements.set('.chat-scroll-area', scrollArea);
  }

  getElementById(id: string): MockElement | null {
    if (this.elements.has(id)) {
      return this.elements.get(id) || null;
    }
    for (const root of this.elements.values()) {
      const found = root.querySelector('#' + id);
      if (found) return found;
    }
    const fallback = new MockElement('div', id);
    this.elements.set(id, fallback);
    return fallback;
  }

  querySelector(sel: string): MockElement | null {
    if (sel.startsWith('#')) return this.getElementById(sel.slice(1));
    if (this.elements.has(sel)) return this.elements.get(sel)!;
    return null;
  }

  querySelectorAll(_sel: string): MockElement[] {
    return [];
  }

  createElement(tagName: string): MockElement {
    return new MockElement(tagName);
  }

  createTextNode(text: string): MockElement {
    const el = new MockElement('#text');
    el.textContent = text;
    return el;
  }
}

test('UI-level regression: panel.js routes taskOutput to active view, isolates concurrent tasks, and restores full buffer', () => {
  const panelJsPath = path.resolve(__dirname, '../media/panel.js');
  const panelJsCode = fs.readFileSync(panelJsPath, 'utf8');

  const doc = new MockDocument();
  const chatMessages = doc.getElementById('chat-messages')!;

  type MessageListener = (event: { data: Record<string, unknown> }) => void;
  const messageListeners: MessageListener[] = [];

  const mockWindow: Record<string, unknown> = {
    addEventListener: (type: string, listener: MessageListener) => {
      if (type === 'message') {
        messageListeners.push(listener);
      }
    },
    removeEventListener: () => {},
    dispatchEvent: () => {},
    showBatonToast: () => {},
  };

  const postedMessages: unknown[] = [];
  const mockVsCode = {
    postMessage: (msg: unknown) => {
      postedMessages.push(msg);
    },
    getState: () => ({}),
    setState: () => {},
  };

  // Run panel.js inside our simulated browser environment
  const runner = new Function(
    'window',
    'document',
    'acquireVsCodeApi',
    'initializeResources',
    'requestAnimationFrame',
    'navigator',
    panelJsCode,
  );

  runner(
    mockWindow,
    doc,
    () => mockVsCode,
    () => undefined,
    (cb: () => void) => cb(),
    { clipboard: { writeText: async () => {} } },
  );

  assert.ok(messageListeners.length > 0, 'panel.js must register a message listener');
  const dispatch = (data: Record<string, unknown>) => {
    for (const listener of messageListeners) {
      try {
        listener({ data });
      } catch (e) {
        console.error('Error in listener for', data.type, e);
      }
    }
  };

  const getTaskOutputBuffer = (mockWindow as { __batonGetTaskOutputBuffer?: (id: string) => unknown[] }).__batonGetTaskOutputBuffer;
  assert.equal(typeof getTaskOutputBuffer, 'function', 'panel.js must expose __batonGetTaskOutputBuffer for verification');

  // Step 1: User opens task A
  dispatch({
    type: 'activeSession',
    session: { id: 'sess-A', taskIds: ['task-A'], title: 'Task A' },
    tasks: [{ id: 'task-A', text: 'Task A Text', status: 'running', createdAt: new Date().toISOString() }],
    flow: { state: 'race_ready', race: { steps: [{ id: 'S1', title: 'Step 1', agent: 'codex', model: 'gpt-4o' }] } },
    outputBuffer: [],
    sessionId: 'sess-A',
    taskId: 'task-A',
  });

  // Step 2: Stream chunk 1 for task A
  dispatch({
    type: 'taskOutput',
    project_id: 'proj-1',
    task_id: 'task-A',
    run_id: 'run-A1',
    chunk: 'Task A - Output Chunk 1',
    stream: 'stdout',
    timestamp: new Date().toISOString(),
  });

  // Assert chunk 1 is rendered into active DOM
  assert.ok(chatMessages.textContent.includes('Task A - Output Chunk 1'));

  // Step 3: Stream chunk 1 for background task B while task A is active
  dispatch({
    type: 'taskOutput',
    project_id: 'proj-1',
    task_id: 'task-B',
    run_id: 'run-B1',
    chunk: 'Task B - Output Chunk 1',
    stream: 'stdout',
    timestamp: new Date().toISOString(),
  });

  // Assert task B chunk is NOT rendered in task A's DOM
  assert.ok(!chatMessages.textContent.includes('Task B - Output Chunk 1'));

  // Step 4: User switches active view to Session B
  dispatch({
    type: 'activeSession',
    session: { id: 'sess-B', taskIds: ['task-B'], title: 'Task B' },
    tasks: [{ id: 'task-B', text: 'Task B Text', status: 'running', createdAt: new Date().toISOString() }],
    flow: { state: 'race_ready', race: { steps: [{ id: 'S1', title: 'Step 1', agent: 'codex', model: 'gpt-4o' }] } },
    outputBuffer: [],
    sessionId: 'sess-B',
    taskId: 'task-B',
  });

  // Assert B's DOM contains B's output and NEVER contains A's output!
  assert.ok(chatMessages.textContent.includes('Task B - Output Chunk 1'));
  assert.ok(!chatMessages.textContent.includes('Task A - Output Chunk 1'));

  // Step 5: Concurrently stream chunk 2 for task A while active view is B
  dispatch({
    type: 'taskOutput',
    project_id: 'proj-1',
    task_id: 'task-A',
    run_id: 'run-A1',
    chunk: 'Task A - Output Chunk 2',
    stream: 'stdout',
    timestamp: new Date().toISOString(),
  });

  // Assert B's DOM STILL contains no output from task A
  assert.ok(!chatMessages.textContent.includes('Task A'));
  assert.ok(!chatMessages.textContent.includes('Task A - Output Chunk 2'));

  // Step 6: User switches view back to Session A
  dispatch({
    type: 'activeSession',
    session: { id: 'sess-A', taskIds: ['task-A'], title: 'Task A' },
    tasks: [{ id: 'task-A', text: 'Task A Text', status: 'running', createdAt: new Date().toISOString() }],
    flow: { state: 'race_ready', race: { steps: [{ id: 'S1', title: 'Step 1', agent: 'codex', model: 'gpt-4o' }] } },
    outputBuffer: [],
    sessionId: 'sess-A',
    taskId: 'task-A',
  });

  // Assert A's DOM now contains BOTH chunk 1 and chunk 2, and ZERO of B's output!
  assert.ok(chatMessages.textContent.includes('Task A - Output Chunk 1'));
  assert.ok(chatMessages.textContent.includes('Task A - Output Chunk 2'));
  assert.ok(!chatMessages.textContent.includes('Task B - Output Chunk 1'));

  // Assert A's buffer is complete
  const aBuffer = getTaskOutputBuffer!('task-A') as Array<{ chunk: string }>;
  assert.equal(aBuffer.length, 2);
  assert.equal(aBuffer[0].chunk, 'Task A - Output Chunk 1');
  assert.equal(aBuffer[1].chunk, 'Task A - Output Chunk 2');

  // Assert B's buffer is complete
  const bBuffer = getTaskOutputBuffer!('task-B') as Array<{ chunk: string }>;
  assert.equal(bBuffer.length, 1);
  assert.equal(bBuffer[0].chunk, 'Task B - Output Chunk 1');
});

test('Agent management modal, center indicator, session dock disable, and done-only race track', () => {
  const mockDoc = new MockDocument();
  let messageHandler: ((evt: { data: unknown }) => void) | null = null;

  const mockWindow = {
    addEventListener: (type: string, handler: (evt: { data: unknown }) => void) => {
      if (type === 'message') messageHandler = handler;
    },
    removeEventListener: () => {},
    showBatonToast: () => {},
  };

  const postedMessages: unknown[] = [];
  const mockVsCode = {
    postMessage: (m: unknown) => {
      postedMessages.push(m);
    },
    getState: () => ({ drafts: {} }),
    setState: () => {},
  };

  const code = fs.readFileSync(path.resolve(__dirname, '../media/panel.js'), 'utf8');
  const fn = new Function('document', 'window', 'acquireVsCodeApi', 'initializeResources', 'requestAnimationFrame', 'setTimeout', 'clearTimeout', code);
  fn(
    mockDoc,
    mockWindow,
    () => mockVsCode,
    undefined,
    (cb: () => void) => cb(),
    (cb: () => void) => cb(),
    () => {},
  );

  const dispatch = (data: unknown) => {
    assert.ok(messageHandler, 'Message handler must be registered');
    messageHandler({ data });
  };

  const raceTrack = mockDoc.getElementById('agent-race-track')!;
  const centerIndicator = mockDoc.getElementById('center-agent-indicator')!;
  const centerName = mockDoc.getElementById('center-agent-name')!;
  const centerAvatar = mockDoc.getElementById('center-agent-avatar')!;
  const dockActiveAgents = mockDoc.getElementById('dock-active-agents')!;
  const floatingAddBtn = mockDoc.getElementById('floating-add-agent-btn')!;
  const agentModal = mockDoc.getElementById('agent-manager-modal')!;
  const agentForm = mockDoc.getElementById('agent-form')!;
  const nameInput = mockDoc.getElementById('agent-name-input')!;
  const modelsInput = mockDoc.getElementById('agent-models-input')!;
  const sessionModal = mockDoc.getElementById('agent-session-modal')!;
  const sessionName = mockDoc.getElementById('session-agent-name')!;
  const sessionToggleDisableBtn = mockDoc.getElementById('session-toggle-disable-btn')!;
  const floatingAgentsList = mockDoc.getElementById('floating-agents-list')!;

  // 1. Initial State: Race track must be hidden by default
  assert.equal(raceTrack.hidden, true, 'Race track must be hidden before task is done');

  // Center indicator should be visible with default active agent and AI bot icon
  assert.equal(centerIndicator.hidden, false, 'Center agent indicator should be visible');
  assert.equal(centerName.textContent, 'Claude Architect');
  assert.ok(centerAvatar.className.includes('bg-purple'));
  assert.ok(centerAvatar.textContent.includes('agent-bot-svg'), 'Center avatar should contain AI bot SVG');

  // Dock should not contain agent buttons; Floating list renders badges with AI bot icons
  assert.equal(dockActiveAgents.children.length, 0, 'Dock must not contain agent buttons');
  assert.equal(floatingAgentsList.children.length, 3, 'Floating list should contain initial 3 agent cards');
  assert.ok(floatingAgentsList.children[0].textContent.includes('agent-bot-svg'), 'Floating agent card should contain AI bot SVG');

  // 2. Open Agent Manager Modal via floating button
  assert.equal(agentModal.hidden, true);
  floatingAddBtn.listeners['click']?.[0]?.({});
  assert.equal(agentModal.hidden, false, 'Modal should open on floating button click');

  // 3. Add a new agent via form submission
  nameInput.value = 'DeepSeek Coder';
  modelsInput.value = 'deepseek-coder-v2';
  // Simulate radio choice for cyan
  const cyanRadio = new MockElement('input');
  cyanRadio.setAttribute('name', 'agent-color');
  cyanRadio.setAttribute('value', 'cyan');
  cyanRadio.setAttribute('checked', 'true');
  cyanRadio.value = 'cyan';
  cyanRadio.checked = true;
  agentForm.append(cyanRadio);

  agentForm.listeners['submit']?.[0]?.({ preventDefault: () => {} });

  // Modal closes and new agent becomes active in center
  assert.equal(agentModal.hidden, true, 'Modal should close on submit');
  assert.equal(centerName.textContent, 'DeepSeek Coder');
  assert.ok(centerAvatar.className.includes('bg-cyan'));
  assert.equal(dockActiveAgents.children.length, 0, 'Dock must remain empty of agent icons');
  assert.equal(floatingAgentsList.children.length, 4, 'Floating list should now have 4 active agents');

  // 4. Inspect agent in floating list and disable for this task session
  const lastFloatingCard = floatingAgentsList.children[3];
  lastFloatingCard.listeners['click']?.[0]?.({ preventDefault: () => {}, stopPropagation: () => {} });

  assert.equal(sessionModal.hidden, false, 'Session inspection modal should open');
  assert.equal(sessionName.textContent, 'DeepSeek Coder');

  // Click disable for this session
  sessionToggleDisableBtn.listeners['click']?.[0]?.({});
  assert.equal(sessionModal.hidden, true, 'Session modal should close on toggle');
  assert.equal(dockActiveAgents.children.length, 0, 'Dock must remain empty of agent icons');
  assert.equal(floatingAgentsList.children.length, 3, 'Disabled agent must disappear from floating agents list');

  // 5. Race Track and Finish Race behavior: Appears strictly when session is marked Done
  const finishRaceBtn = mockDoc.getElementById('finish-race-btn')!;
  assert.equal(finishRaceBtn.hidden, true, 'Finish race button must be hidden when session has no tasks');

  // Send running task session with 1 task
  dispatch({
    type: 'activeSession',
    session: { id: 'sess-active-1', taskIds: ['task-1'], title: 'Ongoing Race Session' },
    tasks: [{ id: 'task-1', text: 'Build feature', status: 'running', createdAt: new Date().toISOString() }],
    flow: { state: 'race_ready', race: { steps: [{ id: 'S1', title: 'Route', agent: 'gemma' }] } },
    outputBuffer: [],
  });
  assert.equal(raceTrack.hidden, true, 'Race track must remain hidden during ongoing task');
  assert.equal(finishRaceBtn.hidden, false, 'Finish race button must be visible when session has tasks and is active');

  // Clicking finish race button must send finishRaceSession
  finishRaceBtn.listeners['click']?.[0]?.({});
  assert.ok(postedMessages.some((m) => typeof m === 'object' && m !== null && (m as any).type === 'finishRaceSession' && (m as any).sessionId === 'sess-active-1'));

  // Mark session done with multiple tasks (laps)
  dispatch({
    type: 'activeSession',
    session: { id: 'sess-active-1', taskIds: ['task-1', 'task-2'], title: 'Completed Race', finished: true },
    tasks: [
      { id: 'task-1', text: 'Build feature', status: 'done', lapNumber: 1, finishSummary: 'Feature implemented', createdAt: new Date().toISOString() },
      { id: 'task-2', text: 'Add tests', status: 'done', lapNumber: 2, finishSummary: 'Tests pass', createdAt: new Date().toISOString() },
    ],
    flow: { state: 'done' },
    outputBuffer: [],
  });
  assert.equal(raceTrack.hidden, false, 'Race track MUST appear when race session is marked done');
  assert.equal(finishRaceBtn.hidden, true, 'Finish race button must be hidden when race is finished');
  const raceSteps = mockDoc.getElementById('race-track-steps')!;
  assert.equal(raceSteps.children.length, 2, 'Race track must have rendered 2 relay lap nodes');
  assert.ok(raceSteps.children[0].textContent.includes('Lap 1: Build feature'));
  assert.ok(raceSteps.children[1].textContent.includes('Lap 2: Add tests'));

  // Starting a new race session must hide the race track again
  const newSessionHeaderBtn = mockDoc.getElementById('new-session-header-btn')!;
  newSessionHeaderBtn.listeners['click']?.[0]?.({});
  assert.equal(raceTrack.hidden, true, 'Race track must be hidden when starting a new race session');
});

test('Gamified Relay Card renders runner, conditional GitHub button, and MCP summary sync', () => {
  const mockDoc = new MockDocument();
  let messageHandler: ((evt: { data: unknown }) => void) | null = null;
  const postedMessages: unknown[] = [];

  const mockWindow = {
    addEventListener: (type: string, handler: (evt: { data: unknown }) => void) => {
      if (type === 'message') messageHandler = handler;
    },
    removeEventListener: () => {},
    showBatonToast: () => {},
  };

  const mockVsCode = {
    postMessage: (msg: unknown) => {
      postedMessages.push(msg);
    },
    getState: () => ({ drafts: {} }),
    setState: () => {},
  };

  const code = fs.readFileSync(path.resolve(__dirname, '../media/panel.js'), 'utf8');
  const fn = new Function('document', 'window', 'acquireVsCodeApi', 'initializeResources', 'requestAnimationFrame', 'setTimeout', 'clearTimeout', code);
  fn(
    mockDoc,
    mockWindow,
    () => mockVsCode,
    undefined,
    (cb: () => void) => cb(),
    (cb: () => void) => cb(),
    () => {},
  );

  const dispatch = (data: unknown) => {
    assert.ok(messageHandler, 'Message handler must be registered');
    messageHandler({ data });
  };

  // 1. Dispatch routed message with GitHub attached = true
  dispatch({
    type: 'routed',
    requestId: 101,
    taskId: 'task-lap-1',
    text: 'Plan auth migration and architecture',
    decision: {
      route: {
        task_type: 'planning',
        risk_tier: 'low',
        recommended_destination: 'claude',
        research_needed: false,
        reason: 'Planning task routed to Claude Architect Web Agent',
      },
      action: 'RUN',
      why: 'Planning task routed to Claude Architect Web Agent',
    },
    tier: 'rules',
    saved: true,
    agentType: 'web',
    githubAttached: true,
    githubUrl: 'https://github.com/my-org/my-project',
    lapNumber: 1,
    runnerAgent: {
      id: 'agent-1',
      name: 'Claude Architect',
      type: 'web',
      models: 'claude-3-7-sonnet',
      color: 'purple',
      githubAttached: true,
      url: 'https://github.com/my-org/my-project',
      capabilities: ['planning'],
      enabled: true,
    },
  });

  const chatMessages = mockDoc.getElementById('chat-messages')!;
  assert.ok(chatMessages.children.length > 0, 'Relay message must be added to chat');

  // Verify Lap banner & Runner name
  assert.ok(chatMessages.textContent.includes('Lap 1 · Baton Handed to Runner'));
  assert.ok(chatMessages.textContent.includes('Claude Architect'));
  assert.ok(chatMessages.textContent.includes('Web Agent'));

  // Verify "Open in GitHub" button exists because githubAttached is true
  const openGithubBtns = chatMessages.querySelectorAll('.btn-relay-open');
  assert.equal(openGithubBtns.length, 1, 'Open in GitHub button must be present when agent is attached to GitHub');
  assert.ok(openGithubBtns[0].textContent.includes('Open in Claude Architect (GitHub)'));

  // Click the Open in GitHub button
  openGithubBtns[0].listeners['click']?.[0]?.({});
  assert.deepEqual(postedMessages[postedMessages.length - 1], {
    type: 'openExternalUrl',
    url: 'https://github.com/my-org/my-project',
  });

  // Verify MCP Summary container exists with input & save button
  const summaryBox = mockDoc.getElementById('relay-summary-box-task-lap-1');
  assert.ok(summaryBox, 'Summary container must be rendered');
  const summaryInput = mockDoc.getElementById('lap-summary-input-task-lap-1');
  assert.ok(summaryInput, 'Summary textarea must be rendered');
  const saveBtn = summaryBox.querySelector('.btn-save-mcp');
  assert.ok(saveBtn, 'Save Lap Summary button must be rendered');

  // Submit MCP lap summary
  summaryInput.value = 'Planned auth migration with JWT tokens and OAuth2 strategy.';
  saveBtn.listeners['click']?.[0]?.({});

  assert.deepEqual(postedMessages[postedMessages.length - 1], {
    type: 'finishTask',
    taskId: 'task-lap-1',
    summary: 'Planned auth migration with JWT tokens and OAuth2 strategy.',
  });

  // Verify that if finishError occurs, button is re-enabled and reset
  dispatch({
    type: 'finishError',
    taskId: 'task-lap-1',
    message: 'Could not finish this task.',
  });
  assert.equal(saveBtn.disabled, false, 'Save button must be re-enabled on error');
  assert.ok(saveBtn.textContent.includes('Save Lap Summary'), 'Save button text must reset on error');

  // Verify that on taskFinished, the summary box transitions to recorded MCP badge
  dispatch({
    type: 'taskFinished',
    taskId: 'task-lap-1',
    summary: 'Planned auth migration with JWT tokens and OAuth2 strategy.',
    notice: 'Summary saved for MCP agents.',
  });
  assert.ok(summaryBox.textContent.includes('Lap summary indexed to MCP Memory:'));
  assert.ok(summaryBox.textContent.includes('Planned auth migration with JWT tokens'));

  // 2. Dispatch routed message with githubAttached = false
  dispatch({
    type: 'routed',
    requestId: 102,
    taskId: 'task-lap-2',
    text: 'Fix typo in src/index.ts',
    decision: {
      route: {
        task_type: 'implementation',
        risk_tier: 'low',
        recommended_destination: 'codex',
        research_needed: false,
        reason: 'Local fix routed to Codex Runner',
      },
      action: 'RUN',
      why: 'Local fix routed to Codex Runner',
    },
    tier: 'rules',
    saved: true,
    agentType: 'local',
    githubAttached: false,
    lapNumber: 2,
    runnerAgent: {
      id: 'agent-2',
      name: 'Codex Runner',
      type: 'local',
      models: 'codex',
      color: 'cyan',
      githubAttached: false,
      capabilities: ['code'],
      enabled: true,
    },
  });

  // Verify that the second card does NOT have an open GitHub button
  const routingCards = chatMessages.querySelectorAll('.relay-lap-banner');
  assert.equal(routingCards.length, 2);
  const secondCardOpenBtns = chatMessages.querySelectorAll(`[data-task-id="task-lap-2"] .btn-relay-open`);
  assert.equal(secondCardOpenBtns.length, 0, 'No GitHub button should be rendered when githubAttached is false');

  // 3. Verify that when task is done or has finishSummary, summary is rendered as recorded badge
  dispatch({
    type: 'activeSession',
    session: { id: 'sess-finished', taskIds: ['task-done-1'], title: 'Completed Lap' },
    tasks: [{
      id: 'task-done-1',
      text: 'Design schema',
      status: 'done',
      finishSummary: 'Designed users and teams tables in PostgreSQL.',
      createdAt: new Date().toISOString(),
    }],
    flow: { state: 'done' },
    outputBuffer: [],
  });

  assert.ok(chatMessages.textContent.includes('Designed users and teams tables in PostgreSQL.'));
});

