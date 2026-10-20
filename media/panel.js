(() => {
  const vscode = acquireVsCodeApi();
  const resourcesManager = typeof initializeResources === 'function' ? initializeResources(vscode) : undefined;

  const form = document.getElementById('task-form');
  const task = document.getElementById('task');
  const submit = form?.querySelector('button[type="submit"]');
  const micBtn = document.getElementById('mic-btn');
  const handoffFallback = document.getElementById('handoff-fallback');
  const openHandoffExternal = document.getElementById('open-handoff-external');
  const toastContainer = document.getElementById('toast-container');

  const newSessionHeaderBtn = document.getElementById('new-session-header-btn');
  const tipCloseBtn = document.getElementById('tip-close-btn');
  const autoModeCard = document.getElementById('auto-mode-card');
  const sessionChip = document.getElementById('session-chip');
  const heroState = document.getElementById('hero-state');
  const chatMessages = document.getElementById('chat-messages');
  const chatScrollArea = document.querySelector('.chat-scroll-area');
  const contextPreview = document.getElementById('context-preview');
  const contextPreviewList = document.getElementById('context-preview-list');
  const contextPreviewStatus = document.getElementById('context-preview-status');
  const contextPreviewCancel = document.getElementById('context-preview-cancel');
  const contextPreviewRoute = document.getElementById('context-preview-route');
  const toggleResearchBtn = document.getElementById('toggle-research-btn');
  const closeResearchBtn = document.getElementById('close-research-btn');
  const refreshResearchBtn = document.getElementById('refresh-research-btn');
  const researchSidebar = document.getElementById('research-sidebar');

  const chatNoProjectBanner = document.getElementById('chat-no-project-banner');
  const chatOpenProjectBtn = document.getElementById('chat-open-project-btn');

  function setSidebarCollapsed(collapsed) {
    if (!researchSidebar) return;
    researchSidebar.classList.toggle('collapsed', collapsed);
    if (toggleResearchBtn) {
      toggleResearchBtn.classList.toggle('active', !collapsed);
      toggleResearchBtn.setAttribute('aria-pressed', String(!collapsed));
    }
  }

  toggleResearchBtn?.addEventListener('click', () => {
    const isCollapsed = researchSidebar?.classList.contains('collapsed');
    setSidebarCollapsed(!isCollapsed);
  });

  closeResearchBtn?.addEventListener('click', () => {
    setSidebarCollapsed(true);
  });

  refreshResearchBtn?.addEventListener('click', () => {
    const lastTurnEl = chatMessages?.querySelector('.assistant-turn[data-task-id]:last-of-type') || chatMessages?.querySelector('[data-task-id]:last-child');
    const taskId = activeTaskId || lastTurnEl?.dataset?.taskId;
    const lastUserMsg = chatMessages?.querySelector('.user-message-card:last-of-type .user-message-text');
    const query = lastUserMsg?.textContent?.trim() || sessionChip?.textContent?.trim() || '';
    if (query) {
      vscode.postMessage({ type: 'refreshResources', taskId, query });
    }
  });

  const finishRaceBtn = document.getElementById('finish-race-btn');
  const completeNewTaskBtn = document.getElementById('complete-new-task-btn');
  const taskCompleteBanner = document.getElementById('task-complete-banner');

  let requestId = 0;
  let pendingPreview = null;
  let hasProject = true;
  let activePlanTextarea = null;
  let activeSessionId = null;
  let activeTaskId = null;
  let currentTaskStatus = null;
  let closedSession = false;
  const taskOutputBuffers = new Map();

  function setComposerClosed(closed) {
    closedSession = Boolean(closed);
    if (taskCompleteBanner) {
      taskCompleteBanner.hidden = !closedSession;
    }
    if (task) {
      task.disabled = closedSession || !hasProject;
      if (closedSession) {
        task.placeholder = 'Race session finished · Relay pipeline recorded';
      } else {
        task.placeholder = 'Ask Baton to edit, route, or build... (Enter to route, Shift+Enter for newline)';
      }
    }
    if (submit) submit.disabled = closedSession || !hasProject;
    if (micBtn) micBtn.disabled = closedSession || !hasProject;
    if (finishRaceBtn && closedSession) {
      finishRaceBtn.hidden = true;
    }
    if (closedSession) {
      removeLapFinishButton(false);
    }
  }

  function copyText(text, label = 'Prompt') {
    if (!text) return;
    try {
      vscode.postMessage({ type: 'copyToClipboard', text });
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
      showToast(`${label} copied to clipboard.`, 'success', 2500);
    } catch {
      showToast(`Could not copy ${label.toLowerCase()}.`, 'warning', 2500);
    }
  }

  completeNewTaskBtn?.addEventListener('click', () => {
    hideRaceTrack();
    vscode.postMessage({ type: 'newSession' });
  });

  function saveDraft(value) {
    const state = vscode.getState() || {};
    const drafts = { ...(state.drafts || {}) };
    if (activeSessionId) drafts[activeSessionId] = value;
    vscode.setState({ drafts });
  }
  const selected = new Set();

  const SEND_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';
  const SPINNER_ICON_SVG = '<svg class="dock-btn-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"></circle><path d="M12 3a9 9 0 0 1 9 9"></path></svg>';
  const BATON_LOGO_SVG = '<svg class="assistant-turn-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 16 10-10a2.12 2.12 0 0 1 3 3L9 19a2.12 2.12 0 0 1-3-3Z"/><path d="m13 9 3 3M5 5v4M3 7h4"/></svg>';

  function scrollChatToBottom() {
    if (!chatScrollArea) return;
    requestAnimationFrame(() => chatScrollArea.scrollTo({ top: chatScrollArea.scrollHeight, behavior: 'smooth' }));
  }

  function setSubmitButtonState(state = 'route', busy = false) {
    if (!submit) return;
    submit.innerHTML = busy ? SPINNER_ICON_SVG : SEND_ICON_SVG;
    const tooltip = busy ? 'Routing task…' : 'Route task (Enter)';
    submit.setAttribute('data-tooltip', tooltip);
    submit.setAttribute('aria-label', tooltip);
    submit.removeAttribute('title');
  }

  setSubmitButtonState('route', false);

  if (task) {
    task.value = '';

    function autoResize() {
      task.style.height = 'auto';
      task.style.height = `${Math.min(Math.max(task.scrollHeight, 38), 160)}px`;
    }

    task.addEventListener('input', () => {
      autoResize();
      saveDraft(task.value);
    });
    autoResize();

    task.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form?.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
  }

  if (tipCloseBtn && autoModeCard) {
    tipCloseBtn.addEventListener('click', () => {
      autoModeCard.style.display = 'none';
    });
  }

  document.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!task) return;
      task.value = btn.dataset.prompt || '';
      saveDraft(task.value);
      task.style.height = 'auto';
      task.style.height = `${Math.min(Math.max(task.scrollHeight, 38), 160)}px`;
      task.focus();
    });
  });

  if (finishRaceBtn) {
    finishRaceBtn.addEventListener('click', () => {
      if (!activeSessionId) return;
      vscode.postMessage({ type: 'finishRaceSession', sessionId: activeSessionId });
    });
  }

  if (newSessionHeaderBtn) {
    newSessionHeaderBtn.addEventListener('click', () => {
      if (!hasProject) {
        showToast('Please open or create a project first before creating tasks.', 'warning');
        return;
      }
      hideRaceTrack();
      vscode.postMessage({ type: 'newSession' });
    });
  }

  if (chatOpenProjectBtn) {
    chatOpenProjectBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'openProject' });
    });
  }

  openHandoffExternal?.addEventListener('click', () => {
    if (openHandoffExternal.dataset.target) {
      vscode.postMessage({ type: 'openExternalHandoff', target: openHandoffExternal.dataset.target });
    }
  });

  // ---------------------------------------------------------------------------
  // Friendly Toast Notifications
  // ---------------------------------------------------------------------------
  function showToast(message, type = 'error', duration = 4000) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');

    const icons = {
      error: '✕',
      warning: '⚠️',
      info: 'ℹ️',
      success: '✓',
    };

    const iconEl = document.createElement('span');
    iconEl.className = 'toast-icon';
    iconEl.textContent = icons[type] || 'ℹ️';

    const msgEl = document.createElement('div');
    msgEl.className = 'toast-message';
    msgEl.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Dismiss';
    closeBtn.setAttribute('aria-label', 'Dismiss toast');

    let dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 220);
    }

    closeBtn.addEventListener('click', dismiss);
    toast.append(iconEl, msgEl, closeBtn);
    toastContainer.append(toast);

    if (duration > 0) {
      setTimeout(dismiss, duration);
    }
  }

  window.showBatonToast = showToast;

  // ---------------------------------------------------------------------------
  // Agent Directory, Center Badge & Session Management
  // ---------------------------------------------------------------------------
  const DEFAULT_AGENTS = [
    { id: 'claude-architect', name: 'Claude Architect', models: 'claude-3-7-sonnet', color: 'purple', type: 'web', githubAttached: true, url: 'https://claude.ai/new', capabilities: ['planning', 'architecture', 'uncertainty'] },
    { id: 'codex-cli', name: 'Codex CLI', models: 'codex-cli, gpt-4o', color: 'cyan', type: 'local', githubAttached: false, capabilities: ['coding', 'terminal', 'cli', 'execution'] },
    { id: 'gemini-researcher', name: 'Gemini Researcher', models: 'gemini-2.5-pro', color: 'emerald', type: 'web', githubAttached: true, url: 'https://gemini.google.com/app', capabilities: ['research', 'planning', 'analysis'] },
  ];

  let configuredAgents = [...DEFAULT_AGENTS];
  let activeAgentId = 'claude-architect';
  const disabledAgentsBySession = new Map(); // sessionId -> Set of disabled agent IDs

  // Race Track elements
  const agentRaceTrack = document.getElementById('agent-race-track');
  const raceTrackSteps = document.getElementById('race-track-steps');
  const raceTrackLane = document.getElementById('race-track-lane');
  const raceTrackSegmentsContainer = document.getElementById('race-track-segments-container');
  const raceTrackNodesContainer = document.getElementById('race-track-nodes-container');
  const raceTrackStatusPill = document.getElementById('race-track-status-pill');
  const raceTrackDistanceBadge = document.getElementById('race-track-distance-badge');
  const closeRaceTrackBtn = document.getElementById('close-race-track-btn');
  const toggleTrackBtn = document.getElementById('toggle-track-btn');

  const AGENT_COLORS = {
    purple: '#8b5cf6',
    cyan: '#06b6d4',
    emerald: '#10b981',
    amber: '#f59e0b',
    rose: '#f43f5e',
    blue: '#3b82f6',
    indigo: '#6366f1',
    teal: '#14b8a6',
  };

  function getAgentColorHex(colorName) {
    if (!colorName) return '#06b6d4';
    if (colorName.startsWith('#')) return colorName;
    return AGENT_COLORS[colorName.toLowerCase()] || '#06b6d4';
  }

  // Floating sidebar & modals
  const floatingAgentsSidebar = document.getElementById('floating-agents-sidebar');
  const floatingAgentsList = document.getElementById('floating-agents-list');
  const floatingAddAgentBtn = document.getElementById('floating-add-agent-btn');
  const agentManagerModal = document.getElementById('agent-manager-modal');
  const closeAgentModalBtn = document.getElementById('close-agent-modal-btn');
  const agentForm = document.getElementById('agent-form');
  const agentEditId = document.getElementById('agent-edit-id');
  const agentNameInput = document.getElementById('agent-name-input');
  const agentModelsInput = document.getElementById('agent-models-input');
  const agentTypeWeb = document.getElementById('agent-type-web');
  const agentTypeLocal = document.getElementById('agent-type-local');
  const agentGithubAttached = document.getElementById('agent-github-attached');
  const agentUrlInput = document.getElementById('agent-url-input');
  const agentSubmitBtn = document.getElementById('agent-submit-btn');
  const agentCancelEditBtn = document.getElementById('agent-cancel-edit-btn');
  const agentCountBadge = document.getElementById('agent-count-badge');
  const savedAgentsList = document.getElementById('saved-agents-list');

  // Center indicator elements
  const centerAgentIndicator = document.getElementById('center-agent-indicator');
  const centerAgentAvatar = document.getElementById('center-agent-avatar');
  const centerAgentName = document.getElementById('center-agent-name');
  const centerAgentModelPill = document.getElementById('center-agent-model-pill');
  const centerAgentConfigBtn = document.getElementById('center-agent-config-btn');

  // Hero Team card elements
  const heroTeamRoster = document.getElementById('hero-team-roster');
  const raceTeamCountBadge = document.getElementById('race-team-count-badge');
  const statBatonHolder = document.getElementById('stat-baton-holder');

  // Dock active agents
  const dockActiveAgents = document.getElementById('dock-active-agents');

  // Session inspector modal
  const agentSessionModal = document.getElementById('agent-session-modal');
  const closeAgentSessionModalBtn = document.getElementById('close-agent-session-modal-btn');
  const sessionAgentAvatar = document.getElementById('session-agent-avatar');
  const sessionAgentName = document.getElementById('session-agent-name');
  const sessionAgentType = document.getElementById('session-agent-type');
  const sessionAgentGithub = document.getElementById('session-agent-github');
  const sessionAgentModels = document.getElementById('session-agent-models');
  const sessionAgentStatusBadge = document.getElementById('session-agent-status-badge');
  const sessionEditAgentBtn = document.getElementById('session-edit-agent-btn');
  const sessionToggleDisableBtn = document.getElementById('session-toggle-disable-btn');
  let inspectingAgentId = null;

  // AI Bot SVG markup
  const AI_BOT_SVG = '<svg class="agent-bot-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="3.5"/><circle cx="8.5" cy="13" r="1.5" fill="currentColor"/><circle cx="15.5" cy="13" r="1.5" fill="currentColor"/><path d="M10 16.5h4"/><path d="M12 4v4"/><circle cx="12" cy="3" r="1" fill="currentColor"/><path d="M2 13h2M20 13h2"/></svg>';

  function createBotIconElement() {
    const span = document.createElement('span');
    span.className = 'agent-bot-icon-wrap';
    span.innerHTML = AI_BOT_SVG;
    return span;
  }

  function getSelectedColor() {
    if (!agentForm) return 'purple';
    const checked = agentForm.querySelector?.('input[name="agent-color"]:checked');
    if (checked?.value) return checked.value;
    const radios = agentForm.querySelectorAll ? agentForm.querySelectorAll('input[name="agent-color"]') : [];
    for (const r of radios) {
      if (r.checked || r.getAttribute?.('checked') === 'true') return r.value;
    }
    return 'purple';
  }

  function setSelectedColor(color) {
    if (!agentForm) return;
    const radios = agentForm.querySelectorAll ? agentForm.querySelectorAll('input[name="agent-color"]') : [];
    for (const r of radios) {
      const isMatch = (r.value === color);
      r.checked = isMatch;
      if (r.setAttribute) {
        if (isMatch) r.setAttribute('checked', 'true');
        else r.removeAttribute('checked');
      }
    }
  }

  function updateCenterAgentIndicator(agent) {
    if (!centerAgentIndicator) return;
    if (!agent) {
      centerAgentIndicator.hidden = true;
      return;
    }
    centerAgentIndicator.hidden = false;
    if (centerAgentAvatar) {
      centerAgentAvatar.replaceChildren(createBotIconElement());
      centerAgentAvatar.className = `center-agent-avatar bg-${agent.color || 'purple'}`;
    }
    if (centerAgentName) {
      centerAgentName.textContent = agent.name;
    }
    if (centerAgentModelPill) {
      const primaryModel = (agent.models || '').split(',')[0].trim();
      centerAgentModelPill.textContent = primaryModel || agent.models;
    }
  }

  function renderFloatingAgents() {
    if (!floatingAgentsList) return;
    floatingAgentsList.replaceChildren();

    const sessKey = activeSessionId || 'default-session';
    const disabledSet = disabledAgentsBySession.get(sessKey) || new Set();

    configuredAgents.forEach((agent) => {
      if (disabledSet.has(agent.id)) return; // Exclude disabled agents from floating list for this session

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'floating-agent-item';
      item.title = `${agent.name} (${agent.models}) — Click to configure`;

      const av = document.createElement('div');
      av.className = `floating-agent-avatar bg-${agent.color || 'purple'}`;
      av.replaceChildren(createBotIconElement());

      const meta = document.createElement('div');
      meta.className = 'floating-agent-meta';

      const name = document.createElement('span');
      name.className = 'floating-agent-name';
      name.textContent = agent.name;

      const model = document.createElement('span');
      model.className = 'floating-agent-model';
      const primaryModel = (agent.models || '').split(',')[0].trim();
      model.textContent = primaryModel || agent.models;

      meta.append(name, model);
      item.append(av, meta);

      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openAgentSessionModal(agent.id);
      });

      floatingAgentsList.appendChild(item);
    });
  }

  function renderDockAgents() {
    if (!dockActiveAgents) return;
    dockActiveAgents.replaceChildren();
  }

  function renderSavedAgentsList() {
    if (!savedAgentsList) return;
    savedAgentsList.replaceChildren();

    if (agentCountBadge) {
      agentCountBadge.textContent = `${configuredAgents.length} Configured`;
    }

    configuredAgents.forEach((agent) => {
      const item = document.createElement('div');
      item.className = 'saved-agent-item';

      const left = document.createElement('div');
      left.className = 'saved-agent-left';
      left.title = 'Click to activate this agent in center';
      left.addEventListener('click', () => {
        activeAgentId = agent.id;
        updateCenterAgentIndicator(agent);
        closeAgentManagerModal();
        showToast(`Activated ${agent.name}`, 'info', 2000);
      });

      const av = document.createElement('div');
      av.className = `saved-agent-avatar bg-${agent.color || 'purple'}`;
      av.replaceChildren(createBotIconElement());

      const meta = document.createElement('div');
      meta.className = 'saved-agent-meta';
      const name = document.createElement('strong');
      name.className = 'saved-agent-name';
      name.textContent = agent.name;
      const models = document.createElement('span');
      models.className = 'saved-agent-models';
      models.textContent = agent.models;
      meta.append(name, models);
      left.append(av, meta);

      const actions = document.createElement('div');
      actions.className = 'saved-agent-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-icon-sm';
      editBtn.title = 'Edit agent info';
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        populateAgentForm(agent);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon-sm btn-danger';
      delBtn.title = 'Delete agent';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteAgent(agent.id);
      });

      actions.append(editBtn, delBtn);
      item.append(left, actions);
      savedAgentsList.appendChild(item);
    });
  }

  function openAgentManagerModal() {
    resetAgentForm();
    if (agentManagerModal) agentManagerModal.hidden = false;
    renderSavedAgentsList();
    agentNameInput?.focus();
  }

  function closeAgentManagerModal() {
    if (agentManagerModal) agentManagerModal.hidden = true;
    resetAgentForm();
  }

  function updateHeroRelayTeam() {
    if (raceTeamCountBadge) {
      raceTeamCountBadge.textContent = `${configuredAgents.length} Runners`;
    }
    const currentActive = configuredAgents.find((a) => a.id === activeAgentId) || configuredAgents[0];
    if (statBatonHolder && currentActive) {
      statBatonHolder.textContent = currentActive.name;
    }
    if (!heroTeamRoster) return;
    heroTeamRoster.replaceChildren();

    configuredAgents.forEach((agent) => {
      const chip = document.createElement('div');
      chip.className = `hero-runner-chip bg-${agent.color || 'purple'}`;
      const av = document.createElement('span');
      av.className = 'hero-chip-avatar';
      av.replaceChildren(createBotIconElement());

      const info = document.createElement('div');
      info.className = 'hero-chip-info';
      const name = document.createElement('strong');
      name.className = 'hero-chip-name';
      name.textContent = agent.name;

      const sub = document.createElement('span');
      sub.className = 'hero-chip-role';
      const isWeb = agent.type === 'web';
      sub.textContent = `${isWeb ? '🌐 Web' : '💻 Local'}${agent.githubAttached ? ' · GitHub' : ''}`;

      info.append(name, sub);
      chip.append(av, info);
      heroTeamRoster.appendChild(chip);
    });
  }

  function populateAgentForm(agent) {
    if (!agent) return;
    if (agentEditId) agentEditId.value = agent.id;
    if (agentNameInput) agentNameInput.value = agent.name;
    if (agentModelsInput) agentModelsInput.value = agent.models;
    if (agentTypeWeb && agentTypeLocal) {
      if (agent.type === 'local') {
        agentTypeLocal.checked = true;
        agentTypeWeb.checked = false;
      } else {
        agentTypeWeb.checked = true;
        agentTypeLocal.checked = false;
      }
    }
    if (agentGithubAttached) agentGithubAttached.checked = Boolean(agent.githubAttached);
    if (agentUrlInput) agentUrlInput.value = agent.url || '';
    setSelectedColor(agent.color || 'purple');
    if (agentSubmitBtn) agentSubmitBtn.textContent = 'Update Agent';
    if (agentCancelEditBtn) agentCancelEditBtn.hidden = false;
    agentNameInput?.focus();
  }

  function resetAgentForm() {
    if (agentEditId) agentEditId.value = '';
    if (agentNameInput) agentNameInput.value = '';
    if (agentModelsInput) agentModelsInput.value = '';
    if (agentTypeWeb) agentTypeWeb.checked = true;
    if (agentTypeLocal) agentTypeLocal.checked = false;
    if (agentGithubAttached) agentGithubAttached.checked = false;
    if (agentUrlInput) agentUrlInput.value = '';
    setSelectedColor('purple');
    if (agentSubmitBtn) agentSubmitBtn.textContent = '+ Save Agent';
    if (agentCancelEditBtn) agentCancelEditBtn.hidden = true;
  }

  function saveAgentFromForm(e) {
    if (e) e.preventDefault();
    const name = agentNameInput?.value?.trim();
    const models = agentModelsInput?.value?.trim();
    const color = getSelectedColor();
    const editId = agentEditId?.value?.trim();
    const typeChecked = agentForm?.querySelector?.('input[name="agent-type"]:checked');
    const type = typeChecked?.value === 'local' ? 'local' : 'web';
    const githubAttached = Boolean(agentGithubAttached?.checked);
    const url = agentUrlInput?.value?.trim() || (type === 'web' ? 'https://github.com' : undefined);

    if (!name || !models) {
      showToast('Please enter both agent name and available models.', 'warning');
      return;
    }

    let savedAgent;
    if (editId) {
      const idx = configuredAgents.findIndex((a) => a.id === editId);
      if (idx !== -1) {
        configuredAgents[idx] = { ...configuredAgents[idx], name, models, color, type, githubAttached, url };
        savedAgent = configuredAgents[idx];
      }
    } else {
      const id = 'agent-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      savedAgent = { id, name, models, color, type, githubAttached, url, enabled: true };
      configuredAgents.push(savedAgent);
    }

    activeAgentId = savedAgent.id;
    updateCenterAgentIndicator(savedAgent);
    renderDockAgents();
    renderFloatingAgents();
    renderSavedAgentsList();
    updateHeroRelayTeam();
    closeAgentManagerModal();
    vscode.postMessage({ type: 'saveUserAgents', agents: configuredAgents });
    showToast(`Agent "${name}" saved and active in center.`, 'success', 2500);
  }

  function deleteAgent(id) {
    configuredAgents = configuredAgents.filter((a) => a.id !== id);
    if (activeAgentId === id) {
      activeAgentId = configuredAgents[0]?.id || null;
      const nextAgent = configuredAgents.find((a) => a.id === activeAgentId) || null;
      updateCenterAgentIndicator(nextAgent);
    }
    renderDockAgents();
    renderFloatingAgents();
    renderSavedAgentsList();
    updateHeroRelayTeam();
    vscode.postMessage({ type: 'saveUserAgents', agents: configuredAgents });
    showToast('Agent removed.', 'info', 2000);
  }

  function openAgentSessionModal(agentId) {
    const agent = configuredAgents.find((a) => a.id === agentId);
    if (!agent) return;
    inspectingAgentId = agentId;

    if (sessionAgentAvatar) {
      sessionAgentAvatar.replaceChildren(createBotIconElement());
      sessionAgentAvatar.className = `session-agent-avatar bg-${agent.color || 'purple'}`;
    }
    if (sessionAgentName) sessionAgentName.textContent = agent.name;
    if (sessionAgentModels) sessionAgentModels.textContent = agent.models;
    if (sessionAgentType) {
      sessionAgentType.textContent = agent.type === 'local' ? '💻 Local Agent (Direct Code & CLI)' : '🌐 Web Agent (Planning & Research)';
    }
    if (sessionAgentGithub) {
      sessionAgentGithub.textContent = agent.githubAttached ? '✓ Attached to GitHub' : '— Not attached';
    }

    const sessKey = activeSessionId || 'default-session';
    const disabledSet = disabledAgentsBySession.get(sessKey) || new Set();
    const isDisabled = disabledSet.has(agentId);

    if (sessionAgentStatusBadge) {
      sessionAgentStatusBadge.className = isDisabled ? 'status-badge-disabled' : 'status-badge-active';
      sessionAgentStatusBadge.textContent = isDisabled ? 'Disabled for this session' : 'Active & Enabled';
    }
    if (sessionToggleDisableBtn) {
      sessionToggleDisableBtn.textContent = isDisabled ? 'Enable for this task session' : 'Disable for this task session';
      sessionToggleDisableBtn.className = isDisabled ? 'btn-primary' : 'btn-danger';
    }

    if (agentSessionModal) agentSessionModal.hidden = false;
  }

  function closeAgentSessionModal() {
    if (agentSessionModal) agentSessionModal.hidden = true;
    inspectingAgentId = null;
  }

  function toggleDisableAgentForSession() {
    if (!inspectingAgentId) return;
    const sessKey = activeSessionId || 'default-session';
    if (!disabledAgentsBySession.has(sessKey)) {
      disabledAgentsBySession.set(sessKey, new Set());
    }
    const disabledSet = disabledAgentsBySession.get(sessKey);
    if (disabledSet.has(inspectingAgentId)) {
      disabledSet.delete(inspectingAgentId);
      showToast('Agent re-enabled for this session.', 'success', 2000);
    } else {
      disabledSet.add(inspectingAgentId);
      showToast('Agent disabled for this task session (hidden from dock and sidebar).', 'info', 2500);
    }

    renderDockAgents();
    renderFloatingAgents();
    closeAgentSessionModal();
  }

  // Race Track visualization: Horizontal straight-line track with agent colors & finish line
  function showRaceTrack(data) {
    if (!agentRaceTrack) return;
    agentRaceTrack.hidden = false;

    if (raceTrackSegmentsContainer) raceTrackSegmentsContainer.replaceChildren();
    if (raceTrackNodesContainer) raceTrackNodesContainer.replaceChildren();
    if (raceTrackSteps) raceTrackSteps.replaceChildren();

    const rawTasks = Array.isArray(data?.tasks) && data.tasks.length > 0 ? data.tasks : [];
    let laps = [];

    if (rawTasks.length > 0) {
      laps = rawTasks.map((t, idx) => {
        const lapNum = t.lapNumber || (idx + 1);
        const runner = t.runnerAgent || configuredAgents.find((a) => a.id === t.runnerAgent?.id) || {
          name: 'Baton Runner',
          color: 'cyan',
          models: t.recommended_model || 'default',
        };
        return {
          lapNum,
          taskText: t.text || 'Task',
          runner,
          agentName: runner.name || 'Baton Runner',
          agentColor: runner.color || 'cyan',
          agentModel: runner.models || t.recommended_model || '',
          finishSummary: t.finishSummary || t.route?.reason || '',
          isDone: Boolean(t.status === 'done' || t.flowStatus === 'done' || t.finishSummary),
        };
      });
    } else {
      const fallbackSteps = (data?.race?.steps?.length ? data.race.steps : null) || [
        { role: 'Router', agent: 'Gemma 4', desc: 'Task triage & risk classification' },
        { role: 'Planner', agent: 'Claude 3.7', desc: 'Plan generation & step decomposition' },
        { role: 'Executor', agent: 'Codex CLI', desc: 'Direct code execution & validation' },
      ];
      laps = fallbackSteps.map((step, idx) => {
        const ag = configuredAgents.find((a) => a.name.toLowerCase().includes((step.agent || '').toLowerCase()) || a.id.includes((step.agent || '').toLowerCase())) || {
          name: step.agent || step.role || 'Runner',
          color: idx === 0 ? 'emerald' : idx === 1 ? 'purple' : 'cyan',
          models: '',
        };
        return {
          lapNum: idx + 1,
          taskText: step.desc || step.summary || step.role || 'Relay step',
          runner: ag,
          agentName: ag.name,
          agentColor: ag.color,
          agentModel: ag.models || '',
          finishSummary: step.desc || step.summary || 'Step completed.',
          isDone: true,
        };
      });
    }

    const N = laps.length;
    if (N === 0) return;

    const TOTAL_METERS = 400;

    laps.forEach((lap, i) => {
      const S_i = (i / N) * 100;
      const E_i = ((i + 1) / N) * 100;
      const W_i = E_i - S_i;
      const M_start = Math.round((i / N) * TOTAL_METERS);
      const M_end = Math.round(((i + 1) / N) * TOTAL_METERS);
      const colorHex = getAgentColorHex(lap.agentColor);

      // 1. Colored Vertical Distance Segment on the Track Lane
      if (raceTrackSegmentsContainer) {
        const seg = document.createElement('div');
        seg.className = 'race-track-segment';
        seg.style.top = `${S_i}%`;
        seg.style.height = `${W_i}%`;
        seg.style.left = '0';
        seg.style.width = '100%';
        seg.style.backgroundColor = colorHex;
        seg.style.color = colorHex;
        seg.style.boxShadow = `0 0 10px ${colorHex}aa`;
        seg.title = `Lap ${lap.lapNum}: ${lap.agentName} (${M_start}m - ${M_end}m)`;
        raceTrackSegmentsContainer.appendChild(seg);
      }

      // 2. Agent Icon Node for Handoff / Finish Line Crossing (Point on the line)
      if (raceTrackNodesContainer) {
        const node = document.createElement('div');
        node.className = 'race-track-handoff-node';
        node.style.top = `${E_i}%`;

        const avatarWrap = document.createElement('div');
        avatarWrap.className = 'race-track-agent-icon-wrap';
        avatarWrap.style.backgroundColor = colorHex;
        avatarWrap.style.color = colorHex;
        avatarWrap.appendChild(createBotIconElement());

        if (i < N - 1) {
          // Handoff point to next runner
          const batonBadge = document.createElement('span');
          batonBadge.className = 'race-track-baton-badge';
          batonBadge.innerHTML = '🪄';
          batonBadge.title = `Baton handed off to Lap ${lap.lapNum + 1}`;
          avatarWrap.appendChild(batonBadge);
        } else {
          // Last agent crossing the finish line!
          node.classList.add('crossing-finish-line');
          const tapeBreak = document.createElement('span');
          tapeBreak.className = 'race-track-finish-tape-break';
          tapeBreak.textContent = '🏆 FINISH!';
          node.appendChild(tapeBreak);

          const batonBadge = document.createElement('span');
          batonBadge.className = 'race-track-baton-badge';
          batonBadge.innerHTML = '🪄';
          batonBadge.title = 'Baton carried across the finish line!';
          avatarWrap.appendChild(batonBadge);
        }

        node.appendChild(avatarWrap);

        // 3. Hover Card: ONLY displayed when user hovers over this point
        const hoverCard = document.createElement('div');
        hoverCard.className = 'race-track-hover-card';

        const hoverHeader = document.createElement('div');
        hoverHeader.className = 'race-track-hover-header';

        const hoverRole = document.createElement('strong');
        hoverRole.className = 'race-track-hover-role';
        hoverRole.textContent = `Lap ${lap.lapNum}`;

        const hoverAgent = document.createElement('span');
        hoverAgent.className = 'race-track-hover-agent';
        hoverAgent.style.color = colorHex;
        hoverAgent.style.borderColor = `${colorHex}66`;
        hoverAgent.style.background = `${colorHex}18`;
        hoverAgent.textContent = lap.agentModel ? `${lap.agentName} (${lap.agentModel})` : lap.agentName;

        hoverHeader.append(hoverRole, hoverAgent);

        const hoverDist = document.createElement('div');
        hoverDist.className = 'race-track-hover-dist';
        hoverDist.textContent = `Leg: ${M_start}m → ${M_end}m (${Math.round(W_i)}% of relay)`;

        const hoverPrompt = document.createElement('div');
        hoverPrompt.className = 'race-track-hover-prompt';
        const truncatedPrompt = lap.taskText.length > 70 ? `${lap.taskText.slice(0, 70)}…` : lap.taskText;
        hoverPrompt.textContent = `"${truncatedPrompt}"`;

        const hoverSummary = document.createElement('div');
        hoverSummary.className = 'race-track-hover-summary';
        hoverSummary.textContent = lap.finishSummary
          ? `✓ MCP: ${lap.finishSummary}`
          : (i === N - 1 ? '🏁 Crossed the finish line.' : 'Handoff completed & recorded.');

        const hoverHint = document.createElement('div');
        hoverHint.className = 'race-track-hover-hint';
        hoverHint.textContent = 'Click to jump to turn';

        hoverCard.append(hoverHeader, hoverDist, hoverPrompt, hoverSummary, hoverHint);
        node.appendChild(hoverCard);

        node.addEventListener('click', () => {
          const allAssistantTurns = chatMessages?.querySelectorAll('.assistant-turn');
          const targetEl = allAssistantTurns?.[lap.lapNum - 1]
            || chatMessages?.querySelector(`[data-task-id="${lap.runner?.id}"]`);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });

        raceTrackNodesContainer.appendChild(node);
      }

      // Populate raceTrackSteps (hidden in UI) for backward compatibility & test introspection
      if (raceTrackSteps) {
        const stepCard = document.createElement('div');
        stepCard.className = `race-track-node ${lap.isDone ? 'node-done' : ''}`;
        stepCard.textContent = `Lap ${lap.lapNum}: ${lap.taskText}`;
        raceTrackSteps.appendChild(stepCard);
      }
    });

    if (raceTrackDistanceBadge) {
      raceTrackDistanceBadge.textContent = `${TOTAL_METERS}m`;
    }
  }

  function hideRaceTrack() {
    if (!agentRaceTrack) return;
    agentRaceTrack.hidden = true;
  }

  closeRaceTrackBtn?.addEventListener('click', hideRaceTrack);
  toggleTrackBtn?.addEventListener('click', () => {
    if (agentRaceTrack) {
      agentRaceTrack.hidden = !agentRaceTrack.hidden;
    }
  });

  // Event wiring for agent manager & modals
  floatingAddAgentBtn?.addEventListener('click', openAgentManagerModal);
  closeAgentModalBtn?.addEventListener('click', closeAgentManagerModal);
  agentCancelEditBtn?.addEventListener('click', resetAgentForm);
  agentForm?.addEventListener('submit', saveAgentFromForm);

  centerAgentConfigBtn?.addEventListener('click', openAgentManagerModal);

  closeAgentSessionModalBtn?.addEventListener('click', closeAgentSessionModal);
  sessionToggleDisableBtn?.addEventListener('click', toggleDisableAgentForSession);
  sessionEditAgentBtn?.addEventListener('click', () => {
    const id = inspectingAgentId;
    closeAgentSessionModal();
    if (id) {
      const agent = configuredAgents.find((a) => a.id === id);
      if (agent) {
        openAgentManagerModal();
        populateAgentForm(agent);
      }
    }
  });

  agentManagerModal?.addEventListener('click', (e) => {
    if (e.target === agentManagerModal) closeAgentManagerModal();
  });
  agentSessionModal?.addEventListener('click', (e) => {
    if (e.target === agentSessionModal) closeAgentSessionModal();
  });

  // Initial render of agents and center indicator
  const initialAgent = configuredAgents.find((a) => a.id === activeAgentId) || configuredAgents[0];
  updateCenterAgentIndicator(initialAgent);
  renderDockAgents();
  renderFloatingAgents();
  renderSavedAgentsList();
  hideRaceTrack();

  // ---------------------------------------------------------------------------
  // Dynamic Finish Race Button Lifecycle & Transitions
  // ---------------------------------------------------------------------------
  function removeLapFinishButton(animate = true) {
    const existingContainers = chatMessages?.querySelectorAll('.lap-finish-actions');
    if (!existingContainers || existingContainers.length === 0) return;

    existingContainers.forEach((container) => {
      if (!animate) {
        container.remove();
        return;
      }
      if (container.classList.contains('finish-btn-disappearing')) {
        return;
      }
      container.classList.remove('finish-btn-appear');
      container.classList.add('finish-btn-disappearing');
      const cleanup = () => {
        container.removeEventListener('animationend', cleanup);
        if (container.parentNode) {
          container.remove();
        }
      };
      container.addEventListener('animationend', cleanup);
      setTimeout(cleanup, 320);
    });
  }

  // ---------------------------------------------------------------------------
  // Chat Turn Creation & Rendering
  // ---------------------------------------------------------------------------
  function appendUserMessage(text, isoTime, isInitialLoad = false) {
    if (!chatMessages) return null;
    if (!isInitialLoad) {
      removeLapFinishButton(true);
    }
    const userTurn = document.createElement('div');
    userTurn.className = 'user-message-turn';

    const bubble = document.createElement('div');
    bubble.className = 'user-message-bubble';
    bubble.textContent = text;

    const meta = document.createElement('div');
    meta.className = 'user-turn-meta';
    const date = isoTime ? new Date(isoTime) : new Date();
    meta.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    userTurn.append(bubble, meta);
    chatMessages.appendChild(userTurn);
    scrollChatToBottom();
    return userTurn;
  }

  function appendAssistantLoadingTurn(reqId, promptText) {
    if (!chatMessages) return null;
    const assistantTurn = document.createElement('div');
    assistantTurn.className = 'assistant-turn';
    assistantTurn.dataset.requestId = String(reqId);

    const header = document.createElement('div');
    header.className = 'assistant-turn-header';
    header.innerHTML = `${BATON_LOGO_SVG}<span class="assistant-turn-name">Baton Router</span>`;

    const loadingCard = document.createElement('div');
    loadingCard.className = 'assistant-loading-card';
    loadingCard.innerHTML = '<span class="spinner"></span> Routing task…';

    assistantTurn.append(header, loadingCard);
    chatMessages.appendChild(assistantTurn);
    scrollChatToBottom();
    return assistantTurn;
  }

  function createAssistantCard(taskId, msgType, headerTitle = 'Baton') {
    if (!chatMessages) return null;
    const turn = document.createElement('article');
    turn.className = 'assistant-turn chat-msg-container';
    turn.dataset.taskId = taskId || '';
    turn.dataset.msgType = msgType || '';

    const header = document.createElement('div');
    header.className = 'assistant-turn-header';
    header.innerHTML = `${BATON_LOGO_SVG}<span class="assistant-turn-name">${headerTitle}</span>`;

    const card = document.createElement('div');
    card.className = 'chat-msg-card';

    turn.append(header, card);
    chatMessages.appendChild(turn);
    scrollChatToBottom();
    return card;
  }

  // Message 1: Routing decision
  function renderMessage1_Routing(taskId, data) {
    if (chatMessages?.querySelector(`[data-task-id="${taskId}"][data-msg-type="routing"]`)) {
      return;
    }
    const card = createAssistantCard(taskId, 'routing', 'Baton Relay Race');
    if (!card) return;

    const action = data.decision?.action || data.decision;
    if (action === 'BLOCK') {
      const p = document.createElement('p');
      p.className = 'chat-msg-body';
      p.textContent = 'This task was blocked by the policy gate. Start a new task to continue.';
      card.appendChild(p);
      return;
    }

    const runner = data.runnerAgent || configuredAgents.find((a) => a.id === activeAgentId) || configuredAgents[0] || {
      name: 'Baton Runner',
      models: 'default',
      color: 'purple',
      type: 'web',
      githubAttached: false,
    };

    const lapNum = data.lapNumber || 1;
    const isWeb = (data.agentType || runner.type) === 'web';
    const hasGithub = Boolean(data.githubAttached || runner.githubAttached);

    // Gamified Lap Header & Runner Card
    const lapBanner = document.createElement('div');
    lapBanner.className = 'relay-lap-banner';

    const lapTitle = document.createElement('div');
    lapTitle.className = 'relay-lap-title';
    lapTitle.innerHTML = `<span class="lap-flag">🏁</span> <strong class="lap-heading">Lap ${lapNum} · Baton Handed to Runner</strong>`;

    const runnerCard = document.createElement('div');
    runnerCard.className = `relay-runner-card runner-theme-${runner.color || 'purple'}`;
    const av = document.createElement('div');
    av.className = `relay-runner-avatar avatar-${runner.color || 'purple'}`;
    av.replaceChildren(createBotIconElement());

    const runnerInfo = document.createElement('div');
    runnerInfo.className = 'relay-runner-info';
    const runnerName = document.createElement('strong');
    runnerName.className = 'relay-runner-name';
    runnerName.textContent = runner.name;

    const runnerTags = document.createElement('div');
    runnerTags.className = 'relay-runner-tags';

    const typeTag = document.createElement('span');
    typeTag.className = `relay-tag ${isWeb ? 'tag-web' : 'tag-local'}`;
    typeTag.textContent = isWeb ? '🌐 Web Agent (Planning & Research)' : '💻 Local Agent (Direct Code & CLI)';

    const modelTag = document.createElement('span');
    modelTag.className = 'relay-tag tag-model';
    modelTag.textContent = data.route?.recommended_model || runner.models?.split(',')[0]?.trim() || 'default';

    runnerTags.append(typeTag, modelTag);
    runnerInfo.append(runnerName, runnerTags);
    runnerCard.append(av, runnerInfo);
    lapBanner.append(lapTitle, runnerCard);
    card.appendChild(lapBanner);

    // Prompt classification & Rationale
    const rationaleP = document.createElement('p');
    rationaleP.className = 'chat-msg-body relay-rationale';
    rationaleP.textContent = data.route?.reason || data.decision?.route?.reason || data.decision?.why || 'Baton classified this prompt and routed to the agent.';
    card.appendChild(rationaleP);

    // Action Buttons Row (Route / Open in GitHub if attached, else no need)
    const actionRow = document.createElement('div');
    actionRow.className = 'relay-action-row';

    if (hasGithub) {
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn-primary btn-sm btn-relay-open';
      openBtn.innerHTML = `🚀 Open in ${runner.name} (GitHub)`;
      openBtn.title = 'Open agent workspace attached to GitHub';
      openBtn.addEventListener('click', () => {
        const targetUrl = data.githubUrl || runner.url || 'https://github.com';
        vscode.postMessage({ type: 'openExternalUrl', url: targetUrl });
      });
      actionRow.appendChild(openBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-secondary btn-sm';
    copyBtn.textContent = '📋 Copy Task Prompt';
    copyBtn.addEventListener('click', () => {
      copyText(data.text, 'Task Prompt');
    });
    actionRow.appendChild(copyBtn);
    card.appendChild(actionRow);

    // One-Click Agent Summary & MCP Memory Section
    const summaryBox = document.createElement('div');
    summaryBox.className = 'relay-summary-container';
    summaryBox.id = `relay-summary-box-${taskId}`;

    const summaryHeading = document.createElement('div');
    summaryHeading.className = 'relay-summary-header';
    summaryHeading.innerHTML = `<span>💾</span> <strong>Baton Memory & MCP Sync</strong>`;

    if (data.finishSummary || data.flowStatus === 'done' || data.status === 'done') {
      const recorded = document.createElement('div');
      recorded.className = 'summary-recorded-badge';
      recorded.innerHTML = `<span class="check-icon">✓</span> <span>Lap summary indexed to MCP Memory:</span>`;
      const quote = document.createElement('blockquote');
      quote.className = 'summary-quote';
      quote.textContent = data.finishSummary || 'Task completed and summary recorded into MCP memory.';
      summaryBox.append(summaryHeading, recorded, quote);
    } else {
      const summaryDesc = document.createElement('p');
      summaryDesc.className = 'summary-desc';
      summaryDesc.textContent = `Record what ${runner.name} accomplished on this task to store in memory for other agents to analyze through MCP:`;

      const summaryInput = document.createElement('textarea');
      summaryInput.className = 'lap-summary-textarea';
      summaryInput.id = `lap-summary-input-${taskId}`;
      summaryInput.rows = 2;
      summaryInput.placeholder = `Summary of what ${runner.name} did on this task...`;

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-primary btn-sm btn-save-mcp';
      saveBtn.innerHTML = `💾 Save Lap Summary to Baton Memory`;
      saveBtn.addEventListener('click', () => {
        const val = summaryInput.value.trim();
        if (!val) {
          showToast('Please enter a brief summary of what the agent did.', 'warning');
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving to MCP...';
        vscode.postMessage({ type: 'finishTask', taskId, summary: val });
      });

      summaryBox.append(summaryHeading, summaryDesc, summaryInput, saveBtn);
    }

    card.appendChild(summaryBox);
  }

  // Message 2: Planning prompt
  function renderMessage2_PlanningPrompt(taskId, data) {
    if (chatMessages?.querySelector(`[data-task-id="${taskId}"][data-msg-type="planning-prompt"]`)) {
      return;
    }
    const card = createAssistantCard(taskId, 'planning-prompt', 'Planning Prompt');
    if (!card) return;

    const platform = ['claude', 'gemini', 'chatgpt'].includes(data.planningPlatform)
      ? data.planningPlatform : 'chatgpt';
    const names = { claude: 'Claude', gemini: 'Gemini', chatgpt: 'ChatGPT' };

    const intro = document.createElement('p');
    intro.className = 'chat-msg-body';
    intro.textContent = 'Use this prompt in your chosen web service, then paste the full plan back here.';
    card.appendChild(intro);

    // Prompt copyable block
    const promptContainer = document.createElement('div');
    promptContainer.className = 'flow-prompt-container';

    const promptHeader = document.createElement('div');
    promptHeader.className = 'flow-prompt-header';
    const promptTitle = document.createElement('span');
    promptTitle.textContent = 'Generated Planning Prompt';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-secondary';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => copyText(data.planningPrompt, 'Planning prompt'));
    promptHeader.append(promptTitle, copyBtn);

    const pre = document.createElement('pre');
    pre.className = 'flow-prompt';
    pre.textContent = data.planningPrompt;

    promptContainer.append(promptHeader, pre);
    card.appendChild(promptContainer);

    // List of files to attach
    if (data.attachFiles?.length) {
      const filesP = document.createElement('p');
      filesP.className = 'flow-muted';
      filesP.innerHTML = `<strong>Files to attach:</strong> ${data.attachFiles.join(', ')}`;
      card.appendChild(filesP);
    }

    // Open recommended service first, others available
    const buttonRow = document.createElement('div');
    buttonRow.className = 'service-btn-row';
    const order = [platform, ...['claude', 'gemini', 'chatgpt'].filter((item) => item !== platform)];
    for (const target of order) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = target === platform ? 'service-btn-rec' : 'btn-secondary';
      btn.textContent = `Open ${names[target]}${target === platform ? ' · Recommended' : ''}`;
      btn.addEventListener('click', () => vscode.postMessage({ type: 'planExternal', target, taskId }));
      buttonRow.appendChild(btn);
    }
    card.appendChild(buttonRow);

    // Task status awaiting_plan
    currentTaskStatus = 'awaiting_plan';
    if (task && !closedSession) {
      task.placeholder = 'Paste the plan here… (Enter to submit)';
    }

    // Inline paste option in chat
    const pasteDetails = document.createElement('details');
    pasteDetails.className = 'turn-context-details';
    pasteDetails.style.marginTop = '8px';
    const pasteSummary = document.createElement('summary');
    pasteSummary.textContent = 'Or paste plan here in panel';
    const pasteBody = document.createElement('div');
    pasteBody.className = 'turn-context-body';

    const planInput = document.createElement('textarea');
    planInput.className = 'flow-plan-input';
    planInput.rows = 5;
    planInput.placeholder = 'Paste your plan here…';
    planInput.value = data.plan || '';

    const planActions = document.createElement('div');
    planActions.className = 'flow-actions';

    const pasteClipBtn = document.createElement('button');
    pasteClipBtn.type = 'button';
    pasteClipBtn.className = 'btn-secondary';
    pasteClipBtn.textContent = 'Paste clipboard';
    pasteClipBtn.addEventListener('click', () => {
      activePlanTextarea = planInput;
      vscode.postMessage({ type: 'readClipboard' });
    });

    const submitPlanBtn = document.createElement('button');
    submitPlanBtn.type = 'button';
    submitPlanBtn.className = 'btn-primary';
    submitPlanBtn.textContent = 'Submit plan';
    const planStatus = document.createElement('p');
    planStatus.className = 'flow-status';

    submitPlanBtn.addEventListener('click', () => {
      const val = planInput.value.trim();
      if (!val) { planStatus.textContent = 'Paste a plan first.'; return; }
      submitPlanBtn.disabled = true;
      planStatus.textContent = 'Processing plan…';
      vscode.postMessage({ type: 'savePlan', taskId, plan: val });
    });

    planActions.append(pasteClipBtn, submitPlanBtn);
    pasteBody.append(planInput, planActions, planStatus);
    pasteDetails.append(pasteSummary, pasteBody);
    card.appendChild(pasteDetails);
  }

  // Message 3: Plan intake
  function renderMessage3_PlanIntake(taskId, data) {
    if (chatMessages?.querySelector(`[data-task-id="${taskId}"][data-msg-type="plan-intake"]`)) {
      return;
    }
    const card = createAssistantCard(taskId, 'plan-intake', 'Plan Accepted');
    if (!card) return;

    const stepCount = data.race?.steps?.length || 'structured';
    const p = document.createElement('p');
    p.className = 'chat-msg-body';
    p.innerHTML = `Plan accepted! Baton extracted <strong>${stepCount} structured steps</strong> with dependencies.`;
    card.appendChild(p);
  }

  // Message 4: Task tree
  function renderMessage4_TaskTree(taskId, data) {
    let existingTurn = chatMessages?.querySelector(`[data-task-id="${taskId}"][data-msg-type="task-tree"]`);
    if (existingTurn) {
      existingTurn.remove();
    }
    const card = createAssistantCard(taskId, 'task-tree', 'Task Execution Tree');
    if (!card) return;

    const intro = document.createElement('p');
    intro.className = 'chat-msg-body';
    intro.textContent = 'Follow the steps below. Each node shows its agent, model, and starting prompt.';
    card.appendChild(intro);

    const steps = (data.race?.steps && data.race.steps.length > 0)
      ? data.race.steps
      : [{ id: 'step-1', title: data.text || 'Execute task', agent: 'codex', model: 'gpt-4o' }];

    const tree = document.createElement('div');
    tree.className = 'task-tree';

    const savedSummaries = data.stepSummaries || {};
    const readyStepIds = new Set(data.readySteps || []);

    for (const step of steps) {
      const stepId = step.id;
      const deps = step.depends_on || [];
      const hasSummary = Boolean(savedSummaries[stepId]);
      const isReady = hasSummary || readyStepIds.has(stepId) || (deps.length === 0);

      const node = document.createElement('div');
      node.className = `step-node ${hasSummary ? 'step-done' : (isReady ? 'step-ready' : 'step-blocked')}`;
      node.dataset.stepId = stepId;

      // Header row
      const headerRow = document.createElement('div');
      headerRow.className = 'step-header-row';

      const titleGroup = document.createElement('div');
      titleGroup.className = 'step-title-group';
      const titleEl = document.createElement('strong');
      titleEl.className = 'step-title';
      titleEl.textContent = `${stepId}: ${step.title}`;
      titleGroup.appendChild(titleEl);

      const badges = document.createElement('div');
      badges.className = 'step-badges';

      const agentBadge = document.createElement('span');
      agentBadge.className = 'step-badge step-badge-agent';
      agentBadge.textContent = step.agent;
      badges.appendChild(agentBadge);

      if (step.model) {
        const modelBadge = document.createElement('span');
        modelBadge.className = 'step-badge step-badge-model';
        modelBadge.textContent = step.model;
        badges.appendChild(modelBadge);
      }

      if (step.parallel_group) {
        const groupBadge = document.createElement('span');
        groupBadge.className = 'step-badge step-badge-parallel';
        groupBadge.textContent = `Group ${step.parallel_group}`;
        badges.appendChild(groupBadge);
      }

      const statusBadge = document.createElement('span');
      statusBadge.className = `step-badge ${hasSummary ? 'step-badge-done' : (isReady ? 'step-badge-ready' : 'step-badge-blocked')}`;
      if (hasSummary) {
        statusBadge.textContent = '✓ Done';
      } else if (isReady) {
        statusBadge.textContent = '● Ready';
      } else {
        statusBadge.textContent = `🔒 Blocked (waiting for ${deps.join(', ')})`;
      }
      badges.appendChild(statusBadge);

      headerRow.append(titleGroup, badges);
      node.appendChild(headerRow);

      // Starting prompt expandable section
      const promptDetails = document.createElement('details');
      promptDetails.className = 'step-handoff-details';
      const promptSummary = document.createElement('summary');
      promptSummary.textContent = 'Starting prompt';

      const promptBody = document.createElement('div');
      promptBody.className = 'step-handoff-body';

      const promptText = data.race?.prompts?.[stepId] || `Execute ${step.title}`;
      const pre = document.createElement('pre');
      pre.className = 'flow-prompt';
      pre.textContent = promptText;

      const actions = document.createElement('div');
      actions.className = 'flow-actions';

      const copyStepBtn = document.createElement('button');
      copyStepBtn.type = 'button';
      copyStepBtn.className = 'btn-secondary';
      copyStepBtn.textContent = 'Copy prompt';
      copyStepBtn.addEventListener('click', () => copyText(promptText, `Prompt for ${stepId}`));
      actions.appendChild(copyStepBtn);

      if (step.agent === 'codex' || data.route?.recommended_destination === 'codex') {
        const runCodexBtn = document.createElement('button');
        runCodexBtn.type = 'button';
        runCodexBtn.className = 'btn-secondary';
        runCodexBtn.textContent = 'Run in Codex';
        runCodexBtn.addEventListener('click', () => {
          runCodexBtn.disabled = true;
          vscode.postMessage({ type: 'runCodex', taskId });
        });
        actions.appendChild(runCodexBtn);
      }

      promptBody.append(pre, actions);
      promptDetails.append(promptSummary, promptBody);
      node.appendChild(promptDetails);

      // Finish summary area
      const summarySection = document.createElement('div');
      summarySection.className = 'step-summary-section';

      if (hasSummary) {
        const savedView = document.createElement('div');
        savedView.className = 'step-saved-summary';
        savedView.innerHTML = `<strong>Saved summary:</strong><p>${savedSummaries[stepId]}</p>`;
        summarySection.appendChild(savedView);
      } else {
        const textarea = document.createElement('textarea');
        textarea.className = 'flow-finish-input';
        textarea.rows = 2;
        textarea.placeholder = `Summary of completed work and results for ${stepId}…`;

        const actRow = document.createElement('div');
        actRow.className = 'flow-actions';

        const saveSummaryBtn = document.createElement('button');
        saveSummaryBtn.type = 'button';
        saveSummaryBtn.className = 'btn-primary';
        saveSummaryBtn.textContent = 'Save step summary';

        const statusLabel = document.createElement('span');
        statusLabel.className = 'flow-status';

        saveSummaryBtn.addEventListener('click', () => {
          const summaryVal = textarea.value.trim();
          if (!summaryVal) {
            statusLabel.textContent = 'Enter summary first.';
            return;
          }
          saveSummaryBtn.disabled = true;
          statusLabel.textContent = 'Saving…';
          vscode.postMessage({ type: 'saveStepSummary', taskId, stepId, summary: summaryVal });
        });

        actRow.append(saveSummaryBtn, statusLabel);
        summarySection.append(textarea, actRow);
      }

      node.appendChild(summarySection);
      tree.appendChild(node);
    }

    card.appendChild(tree);
  }

  // Message 5: Lap Completion
  function renderMessage5_Completion(taskId, data, options = {}) {
    const showFinish = Boolean(options.showFinishButton !== false && !closedSession);
    const animate = !options.isInitialLoad;

    let turn = chatMessages?.querySelector(`[data-task-id="${taskId}"][data-msg-type="completion"]`);
    let card = turn?.querySelector('.chat-msg-card');

    if (!card) {
      card = createAssistantCard(taskId, 'completion', 'Lap Complete');
      if (!card) return;

      card.classList.add('completion-card');

      const header = document.createElement('div');
      header.className = 'completion-header';
      header.innerHTML = '<span>✓</span><span>Lap complete! Recorded in MCP Memory.</span>';

      const desc = document.createElement('p');
      desc.className = 'chat-msg-body';
      desc.textContent = 'This lap has been recorded and indexed for other agents via MCP. Enter your next task prompt below to continue the relay race, or finish the race session.';

      card.append(header, desc);
    }

    if (showFinish) {
      removeLapFinishButton(animate);

      let actions = card.querySelector('.lap-finish-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'flow-actions lap-finish-actions' + (animate ? ' finish-btn-appear' : '');
        actions.dataset.finishTaskId = taskId;

        const finishBtn = document.createElement('button');
        finishBtn.type = 'button';
        finishBtn.className = 'btn-primary lap-finish-btn';
        finishBtn.textContent = '🏁 Finish Race';
        finishBtn.addEventListener('click', () => {
          removeLapFinishButton(true);
          vscode.postMessage({ type: 'finishRaceSession', sessionId: activeSessionId });
        });

        actions.append(finishBtn);
        card.append(actions);
        scrollChatToBottom();
      }
    } else {
      const existing = card.querySelector('.lap-finish-actions');
      if (existing) {
        existing.remove();
      }
    }
  }

  // Sequence orchestrator (Relay Lap Card & Completion)
  function renderFlowSequence(taskId, data, options = {}) {
    if (!taskId) return;
    const closed = data.flowStatus === 'done' || data.flowStatus === 'abandoned' || data.status === 'done';
    const action = data.decision?.action || data.decision;

    // Message 1: Routing decision (Gamified Relay Lap Card with Agent Runner, GitHub button & MCP Memory box)
    renderMessage1_Routing(taskId, data);

    if (action === 'BLOCK') {
      return;
    }

    // Message 5: Completion
    if (closed) {
      renderMessage5_Completion(taskId, data, options);
    }
    scrollChatToBottom();
  }

  // ---------------------------------------------------------------------------
  // Voice Input
  // ---------------------------------------------------------------------------
  if (micBtn) {
    micBtn.removeAttribute('title');
    micBtn.addEventListener('click', () => {
      if (!hasProject) {
        showToast('Please open or create a project first before recording tasks.', 'warning');
        return;
      }
      micBtn.disabled = true;
      micBtn.classList.add('recording');
      micBtn.setAttribute('data-tooltip', 'Recording speech…');
      micBtn.setAttribute('aria-label', 'Recording speech…');
      showToast('Opening voice recorder in VS Code…', 'info', 3000);
      vscode.postMessage({ type: 'startVoiceRecorder' });
    });
  }

  // ---------------------------------------------------------------------------
  // Form Submission (Single Step, Auto-Clean, No Disappearing History)
  // ---------------------------------------------------------------------------
  function routeWithSelectedContext() {
    if (!pendingPreview) return;
    removeLapFinishButton(true);
    const { text, id } = pendingPreview;
    pendingPreview = null;
    if (contextPreview) contextPreview.hidden = true;
    if (task) {
      task.value = '';
      task.style.height = '38px';
      saveDraft('');
    }
    if (heroState) heroState.style.display = 'none';
    appendUserMessage(text, new Date().toISOString());
    appendAssistantLoadingTurn(id, text);
    resourcesManager?.setSearching(text);
    const sessKey = activeSessionId || 'default-session';
    const disabledSet = disabledAgentsBySession.get(sessKey) || new Set();
    const activeAgents = configuredAgents.filter((a) => !disabledSet.has(a.id));
    vscode.postMessage({ type: 'routeTask', text, requestId: id, sources: [...selected], userAgents: activeAgents });
  }

  contextPreviewCancel?.addEventListener('click', () => {
    pendingPreview = null;
    if (contextPreview) contextPreview.hidden = true;
    if (submit) submit.disabled = false;
    setSubmitButtonState('route', false);
    task?.focus();
  });
  contextPreviewRoute?.addEventListener('click', routeWithSelectedContext);

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (closedSession) {
      showToast('This task is closed. Start a new task session.', 'info');
      return;
    }
    if (!hasProject) {
      showToast('Please open or create a project before routing tasks.', 'warning');
      return;
    }
    const promptText = (task?.value || '').trim();
    if (!promptText || submit?.disabled) {
      if (!promptText) {
        showToast('Please enter a coding task before routing.', 'warning');
      }
      return;
    }

    removeLapFinishButton(true);

    // Check if we are awaiting a plan for the active task
    if (currentTaskStatus === 'awaiting_plan' && activeTaskId) {
      setSubmitButtonState('route', true);
      if (submit) submit.disabled = true;
      appendUserMessage(promptText, new Date().toISOString());
      if (task) {
        task.value = '';
        task.style.height = '38px';
        saveDraft('');
      }
      appendAssistantLoadingTurn('plan-intake', promptText);
      vscode.postMessage({ type: 'savePlan', taskId: activeTaskId, plan: promptText });
      return;
    }

    const reqId = ++requestId;
    pendingPreview = { text: promptText, id: reqId };
    setSubmitButtonState('route', true);
    if (submit) submit.disabled = true;
    vscode.postMessage({ type: 'previewContext', text: promptText, requestId: reqId });
  });

  function appendTaskOutputChunk(data) {
    if (!chatMessages) return;
    const tId = data.task_id || data.taskId;
    if (!tId || tId !== activeTaskId) return;

    let outputCard = chatMessages.querySelector(`.task-output-card[data-task-id="${tId}"]`);
    if (!outputCard) {
      outputCard = document.createElement('div');
      outputCard.className = 'assistant-turn task-output-card';
      outputCard.dataset.taskId = tId;

      const header = document.createElement('div');
      header.className = 'assistant-turn-header';
      header.innerHTML = `${BATON_LOGO_SVG}<span class="assistant-turn-name">Task Output</span>`;

      const pre = document.createElement('pre');
      pre.className = 'task-output-content flow-prompt';

      outputCard.append(header, pre);
      chatMessages.appendChild(outputCard);
    }

    const pre = outputCard.querySelector('.task-output-content');
    if (pre) {
      pre.textContent += (pre.textContent ? '\n' : '') + data.chunk;
    }
    scrollChatToBottom();
  }

  function renderTaskOutputBuffer(tId) {
    if (!tId || tId !== activeTaskId) return;
    const buffer = taskOutputBuffers.get(tId) || [];
    for (const chunk of buffer) {
      appendTaskOutputChunk(chunk);
    }
  }

  // ---------------------------------------------------------------------------
  // Extension Message Handling
  // ---------------------------------------------------------------------------
  window.addEventListener('message', ({ data }) => {
    if (!data || typeof data !== 'object') return;

    // Strict cross-session / cross-task filter
    const globalMsgTypes = [
      'activeSession',
      'routed',
      'routeError',
      'raceSessionFinished',
      'userAgentsLoaded',
      'taskOutput',
      'projectState',
      'routerSettingsStatus',
      'personalKeysStatus',
      'mcpStatus',
      'clipboardContent',
      'clipboardCopied',
      'voiceRecorderReady',
      'voiceTranscribing',
      'voiceText',
      'voiceError',
    ];
    if (!globalMsgTypes.includes(data.type)) {
      if (data.sessionId && activeSessionId && data.sessionId !== activeSessionId) return;
      if (data.taskId && activeTaskId && data.taskId !== activeTaskId) return;
      if (data.task_id && activeTaskId && data.task_id !== activeTaskId) return;
    }

    if (data.type === 'taskOutput') {
      const tId = data.task_id || data.taskId;
      if (!tId) return;
      if (!taskOutputBuffers.has(tId)) {
        taskOutputBuffers.set(tId, []);
      }
      taskOutputBuffers.get(tId).push(data);
      if (tId !== activeTaskId) {
        return; // Background task output buffered, never rendered in active view!
      }
      appendTaskOutputChunk(data);
      return;
    }

    if (data.type === 'contextPreview') {
      if (!pendingPreview || data.requestId !== pendingPreview.id) return;
      selected.clear();
      contextPreviewList?.replaceChildren();
      const parts = Array.isArray(data.parts) ? data.parts : [];
      for (const part of parts) {
        if (typeof part?.source !== 'string' || typeof part?.text !== 'string') continue;
        selected.add(part.source);
        const item = document.createElement('div');
        item.className = 'context-preview-item';
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(part.source);
          else selected.delete(part.source);
        });
        label.append(checkbox, document.createTextNode(part.source));
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Preview';
        const preview = document.createElement('pre');
        preview.textContent = part.text;
        details.append(summary, preview);
        item.append(label, details);
        contextPreviewList?.appendChild(item);
      }
      if (contextPreviewStatus) contextPreviewStatus.textContent = parts.length
        ? `Choose what Baton may use for this task (up to ${data.limit} characters).`
        : 'No local project context was found. You can still route the task.';
      if (contextPreview) contextPreview.hidden = false;
      contextPreviewRoute?.focus();
      return;
    }

    if (data.type === 'projectState') {
      hasProject = data.hasProject === true;
      if (chatNoProjectBanner) {
        chatNoProjectBanner.hidden = hasProject;
      }
      if (task) {
        task.disabled = !hasProject || closedSession;
        task.placeholder = hasProject
          ? (closedSession ? 'Task complete · This session is read-only' : 'Ask Baton to edit, route, or build... (Enter to route, Shift+Enter for newline)')
          : 'Please open or create a project first...';
      }
      if (submit) submit.disabled = !hasProject || closedSession;
      if (micBtn) micBtn.disabled = !hasProject || closedSession;
      if (newSessionHeaderBtn) newSessionHeaderBtn.disabled = !hasProject;
      if (!hasProject) {
        if (sessionChip) sessionChip.textContent = 'No project open';
      }
      return;
    }

    if (data.type === 'resourcesSearching') {
      resourcesManager?.setSearching(data.query);
      return;
    }

    if (data.type === 'resourcesReady') {
      setSidebarCollapsed(false);
      resourcesManager?.renderResources(data.resources);
      return;
    }

    if (data.type === 'activeSession') {
      const session = data.session;
      activeSessionId = session?.id || null;
      activeTaskId = session?.taskIds?.[session?.taskIds?.length - 1] || session?.taskIds?.[0] || null;
      pendingPreview = null;
      if (contextPreview) contextPreview.hidden = true;
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      const isDone = Boolean(session?.finished);
      setComposerClosed(isDone);
      if (finishRaceBtn) {
        finishRaceBtn.hidden = isDone || tasks.length === 0;
      }
      if (toggleTrackBtn) {
        toggleTrackBtn.hidden = tasks.length === 0;
      }
      if (isDone) {
        showRaceTrack(data);
      } else {
        hideRaceTrack();
      }
      renderDockAgents();
      renderFloatingAgents();
      updateHeroRelayTeam();
      if (activeTaskId) {
        const current = taskOutputBuffers.get(activeTaskId) || [];
        if (Array.isArray(data.outputBuffer) && data.outputBuffer.length > 0) {
          const seen = new Set(current.map((c) => `${c.run_id || ''}:${c.timestamp || ''}:${c.chunk}`));
          const newChunks = data.outputBuffer.filter((c) => !seen.has(`${c.run_id || ''}:${c.timestamp || ''}:${c.chunk}`));
          taskOutputBuffers.set(activeTaskId, [...newChunks, ...current]);
        }
      }

      if (task) {
        task.value = vscode.getState()?.drafts?.[activeSessionId] || '';
      }
      setSubmitButtonState('route', false);
      if (sessionChip) {
        sessionChip.textContent = session?.title || 'New race session';
      }
      if (chatMessages) {
        chatMessages.replaceChildren();
      }
      resourcesManager?.renderResources({ tier: 'keyword', videos: [], blogs: [], artifacts: [],
        notice: 'Related resources for this task will appear here.' });

      if (tasks.length > 0) {
        if (heroState) heroState.style.display = 'none';
        const lastTaskIsCompleted = !isDone && Boolean(tasks[tasks.length - 1].flowStatus === 'done' || tasks[tasks.length - 1].status === 'done');
        const lastCompletedTaskIndex = lastTaskIsCompleted ? tasks.length - 1 : -1;

        tasks.forEach((t, index) => {
          appendUserMessage(t.text, t.createdAt, true);
          const isLatestCompleted = index === lastCompletedTaskIndex;
          renderFlowSequence(t.id, {
            taskId: t.id,
            route: t.route,
            decision: t.decision,
            routerTier: t.routerTier,
            status: t.status,
            plan: t.plan,
            planningPrompt: t.planningPrompt,
            planningPlatform: t.planningPlatform,
            planningReason: t.planningReason,
            attachFiles: t.attachFiles,
            flowStatus: t.flowStatus,
            race: data.flow?.race,
            stepSummaries: data.flow?.stepSummaries,
            readySteps: data.flow?.readySteps,
            finishSummary: t.finishSummary,
            runnerAgent: t.runnerAgent,
            agentType: t.agentType,
            githubAttached: t.githubAttached,
            githubUrl: t.githubUrl,
            lapNumber: t.lapNumber || 1,
          }, { showFinishButton: isLatestCompleted, isInitialLoad: true });
        });
        if (activeTaskId) {
          renderTaskOutputBuffer(activeTaskId);
        }
      } else {
        if (heroState) heroState.style.display = 'flex';
        updateHeroRelayTeam();
        resourcesManager?.renderResources({
          tier: 'keyword',
          videos: [],
          blogs: [],
          artifacts: [],
          notice: 'Related YouTube tutorials, blogs, and documentation resources will appear here as you prompt Baton.',
        });
      }
      return;
    }

    if (data.type === 'personalKeysStatus') {
      if (data.notice) showToast(data.notice, data.notice.startsWith('Could not') ? 'error' : 'success');
      return;
    }

    if (data.type === 'routerSettingsStatus') {
      if (data.settings) {
        const primaryModel = data.settings.primary === 'ollama'
          ? data.settings.ollamaModel : data.settings.gemmaModel;
        const label = document.getElementById('dock-router-label');
        if (label) label.textContent = primaryModel;
        const pill = document.getElementById('router-indicator-pill');
        if (pill) pill.title = `Primary router: ${primaryModel} (${data.settings.primary === 'ollama' ? 'Ollama Cloud' : 'Google AI Studio'}). Other provider and rules are fallbacks.`;
      }
      if (data.notice) showToast(data.notice, data.notice.startsWith('Could not') || data.notice.startsWith('Choose') ? 'error' : 'success');
      return;
    }

    if (data.type === 'handoffResult') {
      showToast(data.notice || 'Prompt ready.', 'info', 4000);
      if (openHandoffExternal) {
        openHandoffExternal.dataset.target = data.externalTarget || '';
      }
      if (handoffFallback) {
        handoffFallback.hidden = !data.externalTarget;
      }
      return;
    }

    if (data.type === 'handoffExternalResult') {
      showToast(data.notice || 'Opened externally.', 'info', 3500);
      return;
    }

    if (data.type === 'voiceRecorderReady') {
      showToast('Recorder opened in VS Code. Click Start Recording in that tab.', 'info', 4000);
      return;
    }

    if (data.type === 'voiceTranscribing') {
      showToast('Transcribing speech…', 'info', 3000);
      return;
    }

    if (data.type === 'taskActionResult') {
      showToast(data.notice || 'Action executed.', 'info', 3500);
      return;
    }

    if (data.type === 'history') {
      return;
    }

    if (data.type === 'voiceText') {
      if (micBtn) {
        micBtn.disabled = false;
        micBtn.classList.remove('recording');
        micBtn.setAttribute('data-tooltip', 'Speak task (ElevenLabs Voice Input)');
        micBtn.setAttribute('aria-label', 'Speak task (ElevenLabs Voice Input)');
      }
      const spoken = (data.text || '').trim();
      if (spoken && task) {
        task.value = spoken;
        task.style.height = 'auto';
        task.style.height = `${Math.min(Math.max(task.scrollHeight, 38), 160)}px`;
        saveDraft(spoken);
        showToast(`Transcribed: "${spoken}"`, 'success', 2500);
        if (data.autoRoute) {
          form?.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      } else {
        showToast('No speech detected.', 'warning');
      }
      return;
    }

    if (data.type === 'voiceError') {
      if (micBtn) {
        micBtn.disabled = false;
        micBtn.classList.remove('recording');
        micBtn.setAttribute('data-tooltip', 'Speak task (ElevenLabs Voice Input)');
        micBtn.setAttribute('aria-label', 'Speak task (ElevenLabs Voice Input)');
      }
      const msg = data.message || 'Voice transcription error.';
      showToast(msg, msg.includes('cancelled') ? 'info' : 'error');
      return;
    }

    if (data.type === 'clipboardContent') {
      if (typeof data.text === 'string' && data.text && activePlanTextarea) {
        activePlanTextarea.value = data.text;
        showToast('Plan pasted from clipboard.', 'success', 2500);
      } else {
        showToast('Clipboard was empty.', 'warning', 2500);
      }
      return;
    }

    if (data.type === 'planSaved') {
      currentTaskStatus = 'plan_saved';
      if (task) {
        task.placeholder = 'Ask Baton to edit, route, or build... (Enter to route, Shift+Enter for newline)';
      }
      setSubmitButtonState('route', false);
      if (submit) submit.disabled = false;

      // Remove loading indicator if present
      chatMessages?.querySelector('[data-request-id="plan-intake"]')?.remove();

      // Render Message 3 & Message 4 if not already present
      if (!chatMessages?.querySelector(`[data-task-id="${data.taskId}"][data-msg-type="plan-intake"]`)) {
        renderMessage3_PlanIntake(data.taskId, data);
      }
      if (!chatMessages?.querySelector(`[data-task-id="${data.taskId}"][data-msg-type="task-tree"]`)) {
        renderMessage4_TaskTree(data.taskId, data);
      }
      showToast(data.notice || 'Plan saved and extracted.', 'success', 3500);
      return;
    }

    if (data.type === 'stepSummarySaved') {
      const treeCard = chatMessages?.querySelector(`[data-task-id="${data.taskId}"][data-msg-type="task-tree"]`);
      if (treeCard) {
        const node = treeCard.querySelector(`.step-node[data-step-id="${data.stepId}"]`);
        if (node) {
          node.className = 'step-node step-done';
          const badge = node.querySelector('.step-badge-ready, .step-badge-blocked');
          if (badge) {
            badge.className = 'step-badge step-badge-done';
            badge.textContent = '✓ Done';
          }
          const sumSec = node.querySelector('.step-summary-section');
          if (sumSec) {
            sumSec.replaceChildren();
            const savedView = document.createElement('div');
            savedView.className = 'step-saved-summary';
            savedView.innerHTML = `<strong>Saved summary:</strong><p>${data.summary}</p>`;
            sumSec.appendChild(savedView);
          }
        }

        // Update ready steps
        const readyIds = new Set(data.readySteps || []);
        treeCard.querySelectorAll('.step-node:not(.step-done)').forEach((n) => {
          const sId = n.dataset.stepId;
          if (readyIds.has(sId)) {
            n.className = 'step-node step-ready';
            const b = n.querySelector('.step-badge-blocked');
            if (b) {
              b.className = 'step-badge step-badge-ready';
              b.textContent = '● Ready';
            }
          }
        });
      }

      showToast(data.notice || `Summary for ${data.stepId} saved.`, 'success', 3000);

      if (data.allDone) {
        renderMessage5_Completion(data.taskId, data, { showFinishButton: true });
      }
      return;
    }

    if (data.type === 'taskCompleted') {
      renderMessage5_Completion(data.taskId, data, { showFinishButton: true });
      showToast(data.notice || 'Task complete!', 'success', 4000);
      return;
    }

    if (data.type === 'userAgentsLoaded') {
      if (Array.isArray(data.agents) && data.agents.length > 0) {
        configuredAgents = [...data.agents];
        if (!configuredAgents.some((a) => a.id === activeAgentId)) {
          activeAgentId = configuredAgents[0].id;
        }
        const activeAg = configuredAgents.find((a) => a.id === activeAgentId) || configuredAgents[0];
        updateCenterAgentIndicator(activeAg);
        renderDockAgents();
        renderFloatingAgents();
        renderSavedAgentsList();
        updateHeroRelayTeam();
      }
      return;
    }

    if (data.type === 'taskFinished') {
      const summaryBox = chatMessages?.querySelector(`#relay-summary-box-${data.taskId}`);
      if (summaryBox) {
        summaryBox.replaceChildren();
        const heading = document.createElement('div');
        heading.className = 'relay-summary-header';
        heading.innerHTML = `<span>💾</span> <strong>Baton Memory & MCP Sync</strong>`;
        const recorded = document.createElement('div');
        recorded.className = 'summary-recorded-badge';
        recorded.innerHTML = `<span class="check-icon">✓</span> <span>Lap summary indexed to MCP Memory:</span>`;
        const quote = document.createElement('blockquote');
        quote.className = 'summary-quote';
        quote.textContent = data.summary || data.notice || 'Summary saved for MCP agents.';
        summaryBox.append(heading, recorded, quote);
      }
      renderMessage5_Completion(data.taskId, data, { showFinishButton: true });
      if (finishRaceBtn) finishRaceBtn.hidden = false;
      if (toggleTrackBtn) toggleTrackBtn.hidden = false;
      setComposerClosed(false);
      if (task) {
        task.disabled = false;
        task.placeholder = 'Ask Baton for the next lap in this race... (or click Finish Race to end)';
        task.focus();
      }
      if (submit) submit.disabled = false;
      if (micBtn) micBtn.disabled = false;
      showToast(data.notice || 'Lap finished and summary stored in MCP memory. Ready for next lap.', 'success', 3500);
      return;
    }

    if (data.type === 'raceSessionFinished') {
      setComposerClosed(true);
      removeLapFinishButton(false);
      if (finishRaceBtn) finishRaceBtn.hidden = true;
      if (toggleTrackBtn) toggleTrackBtn.hidden = false;
      showRaceTrack(data);
      showToast('Race finished! Handoff pipeline recorded.', 'success', 3500);
      return;
    }

    if (data.type === 'finishError') {
      const summaryBox = chatMessages?.querySelector(`#relay-summary-box-${data.taskId}`);
      if (summaryBox) {
        const saveBtn = summaryBox.querySelector('.btn-save-mcp');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = `💾 Save Lap Summary to Baton Memory`;
        }
      }
      showToast(data.message || 'Could not finish this task.', 'error', 6000);
      return;
    }

    if (data.type === 'planSaveError') {
      setSubmitButtonState('route', false);
      if (submit) submit.disabled = false;
      chatMessages?.querySelector('[data-request-id="plan-intake"]')?.remove();
      showToast(data.message || 'Could not save plan.', 'error');
      return;
    }

    if (data.type === 'routeError') {
      pendingPreview = null;
      if (contextPreview) contextPreview.hidden = true;
      if (submit) submit.disabled = false;
      setSubmitButtonState('route', false);
      const turnEl = chatMessages?.querySelector(`[data-request-id="${data.requestId}"]`);
      if (turnEl) {
        const loadingCard = turnEl.querySelector('.assistant-loading-card');
        if (loadingCard) {
          loadingCard.textContent = 'Could not route this task. Please try again.';
          loadingCard.style.color = 'var(--baton-error)';
        }
      }
      showToast('Could not route this task. Check connection or try again.', 'error');
      return;
    }

    if (data.type === 'scopeAccepted' || data.type === 'scopeDrift') {
      pendingPreview = null;
      if (contextPreview) contextPreview.hidden = true;
      if (submit) submit.disabled = false;
      setSubmitButtonState('route', false);
      if (data.type === 'scopeAccepted') {
        appendUserMessage(data.text, new Date().toISOString());
        const note = document.createElement('div');
        note.className = 'assistant-turn';
        note.textContent = data.notice;
        chatMessages?.appendChild(note);
        if (task) task.value = '';
        saveDraft('');
      } else {
        const note = document.createElement('div');
        note.className = 'assistant-turn';
        const copy = document.createElement('p');
        copy.textContent = data.notice;
        const create = document.createElement('button');
        create.type = 'button';
        create.className = 'btn-primary';
        create.textContent = 'Create new task';
        create.addEventListener('click', () => vscode.postMessage({ type: 'newSessionPrefilled', text: data.text,
          parentTaskId: /closed/i.test(data.notice) ? data.parentTaskId : undefined }));
        note.append(copy, create);
        chatMessages?.appendChild(note);
      }
      return;
    }

    if (data.type === 'draftTask') {
      if (task) {
        task.value = data.text || '';
        saveDraft(task.value);
        task.focus();
      }
      return;
    }

    if (data.type === 'routed' && data.decision?.route) {
      if (submit) submit.disabled = false;
      setSubmitButtonState('route', false);
      if (task) {
        task.placeholder = 'Ask Baton to edit, route, or build... (Enter to route, Shift+Enter for newline)';
      }

      const loadingEl = chatMessages?.querySelector(`[data-request-id="${data.requestId}"]`);
      if (loadingEl) {
        loadingEl.remove();
      }

      activeTaskId = data.taskId;
      if (finishRaceBtn) finishRaceBtn.hidden = false;
      if (toggleTrackBtn) toggleTrackBtn.hidden = false;
      renderFlowSequence(data.taskId, data);
      vscode.postMessage({ type: 'handoffAvailabilityRequest' });

      const action = data.decision?.action;
      const isOverride = Boolean(data.decision?.overrides)
        || /danger\s+keyword\s+raised\s+risk/i.test(data.decision?.why || '')
        || /raised\s+risk/i.test(data.decision?.why || '');

      if (action === 'BLOCK') {
        showToast('Task blocked by policy. Enter a valid coding task.', 'warning');
      } else if (data.notice?.includes('Overlapping open tasks')) {
        showToast(data.notice, 'warning', 6000);
      } else if (isOverride) {
        showToast('Policy overrode the model: risk elevated to high.', 'warning', 4500);
      }
    }
  });

  if (typeof window !== 'undefined') {
    window.__batonTaskOutputBuffers = taskOutputBuffers;
    window.__batonGetTaskOutputBuffer = (taskId) => taskOutputBuffers.get(taskId) || [];
    window.__batonActiveTaskId = () => activeTaskId;
    window.__batonActiveSessionId = () => activeSessionId;
  }

  vscode.postMessage({ type: 'handoffAvailabilityRequest' });
  vscode.postMessage({ type: 'routerSettingsStatus' });
  vscode.postMessage({ type: 'loadUserAgents' });
  vscode.postMessage({ type: 'checkProjectState' });
  updateHeroRelayTeam();
})();
