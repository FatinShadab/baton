(() => {
  const vscode = acquireVsCodeApi();
  const taskActions = initializeTaskActions(vscode);
  initializeHistory(vscode, taskActions);
  const resourcesManager = typeof initializeResources === 'function' ? initializeResources(vscode) : undefined;

  const form = document.getElementById('task-form');
  const task = document.getElementById('task');
  const card = document.getElementById('route-card');
  const submit = form.querySelector('button[type="submit"]');
  const status = document.getElementById('routing-status');
  const preview = document.getElementById('context-preview');
  const sourceList = document.getElementById('context-sources');
  const refresh = document.getElementById('refresh-context');
  const planSection = document.getElementById('plan-section');
  const planText = document.getElementById('plan-text');
  const savePlanBtn = document.getElementById('save-plan');
  const useClipboardBtn = document.getElementById('use-clipboard');
  const planStatus = document.getElementById('plan-status');
  const handoffFallback = document.getElementById('handoff-fallback');
  const openHandoffExternal = document.getElementById('open-handoff-external');
  const micBtn = document.getElementById('mic-btn');
  const mcpBtn = document.getElementById('mcp-btn');
  const mcpConnection = document.getElementById('mcp-connection');
  const mcpEndpoint = document.getElementById('mcp-endpoint-value');
  const mcpCopyConfig = document.getElementById('mcp-copy-config');
  const controls = document.getElementById('task-controls');
  const taskStatus = document.getElementById('task-status');
  const taskOutcome = document.getElementById('task-outcome');
  const overrideCard = document.getElementById('policy-override-note');
  const overrideText = document.getElementById('policy-override-text');
  const toastContainer = document.getElementById('toast-container');
  const settingsStatus = document.getElementById('settings-status');

  const newSessionHeaderBtn = document.getElementById('new-session-header-btn');
  const tipCloseBtn = document.getElementById('tip-close-btn');
  const autoModeCard = document.getElementById('auto-mode-card');
  const toggleContextBtn = document.getElementById('toggle-context-btn');
  const sessionChip = document.getElementById('session-chip');
  const heroState = document.getElementById('hero-state');
  const chatMessages = document.getElementById('chat-messages');
  const dockRouterLabel = document.getElementById('dock-router-label');
  const toggleResearchBtn = document.getElementById('toggle-research-btn');
  const closeResearchBtn = document.getElementById('close-research-btn');
  const researchSidebar = document.getElementById('research-sidebar');

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

  let requestId = 0;
  let ready = false;
  let parts = [];
  let limit = 6000;
  let currentTaskId = '';
  let pendingAutoRoute = false;
  const selected = new Set();
  const tiers = { gemma: 'via Gemma (AI Studio)', ollama: 'via Ollama', rules: 'via rules' };

  const SEND_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';
  const SPINNER_ICON_SVG = '<svg class="dock-btn-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"></circle><path d="M12 3a9 9 0 0 1 9 9"></path></svg>';

  function setSubmitButtonState(state = 'route', busy = false) {
    if (!submit) return;
    submit.innerHTML = busy ? SPINNER_ICON_SVG : SEND_ICON_SVG;
    const isRoute = state === 'route';
    let tooltip = isRoute ? 'Route task (Enter)' : 'Prepare context (Enter)';
    if (busy) {
      tooltip = isRoute ? 'Routing task…' : 'Preparing context…';
    }
    submit.setAttribute('data-tooltip', tooltip);
    submit.setAttribute('aria-label', tooltip);
    submit.removeAttribute('title');
  }

  setSubmitButtonState('route', false);

  task.value = vscode.getState()?.task ?? '';

  function autoResize() {
    task.style.height = 'auto';
    task.style.height = `${Math.min(Math.max(task.scrollHeight, 38), 160)}px`;
  }
  task.addEventListener('input', autoResize);
  autoResize();

  task.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  if (tipCloseBtn && autoModeCard) {
    tipCloseBtn.addEventListener('click', () => {
      autoModeCard.style.display = 'none';
    });
  }

  document.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      task.value = btn.dataset.prompt || '';
      autoResize();
      task.focus();
    });
  });

  if (newSessionHeaderBtn) {
    newSessionHeaderBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'newSession' });
    });
  }

  if (toggleContextBtn) {
    toggleContextBtn.addEventListener('click', () => {
      if (preview.hidden) {
        if (!ready) {
          prepareContext();
        } else {
          preview.hidden = false;
          preview.open = true;
        }
      } else {
        preview.hidden = true;
      }
    });
  }

  mcpBtn.addEventListener('click', () => {
    mcpBtn.disabled = true;
    mcpBtn.textContent = 'Working…';
    vscode.postMessage({ type: 'mcpToggle' });
  });
  if (mcpCopyConfig) {
    mcpCopyConfig.addEventListener('click', () => vscode.postMessage({ type: 'mcpCopyConfig' }));
  }
  openHandoffExternal.addEventListener('click', () => {
    if (openHandoffExternal.dataset.target) {
      vscode.postMessage({ type: 'openExternalHandoff', target: openHandoffExternal.dataset.target });
    }
  });
  vscode.postMessage({ type: 'mcpStatusRequest' });

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

  // Expose globally for history.js and helper modules
  window.showBatonToast = showToast;

  document.querySelectorAll('.personal-key-form').forEach((keyForm) => {
    keyForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = keyForm.querySelector('input');
      const value = input.value.trim();
      if (!value) return;
      vscode.postMessage({ type: 'savePersonalKey', provider: keyForm.dataset.provider, value });
      input.value = '';
      settingsStatus.textContent = 'Saving key…';
    });
  });
  document.querySelectorAll('.remove-key').forEach((button) => {
    button.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearPersonalKey', provider: button.dataset.provider });
      settingsStatus.textContent = 'Removing key…';
    });
  });

  // ---------------------------------------------------------------------------
  // Status Stepper: Routed > Planned > Running > Done
  // ---------------------------------------------------------------------------
  function updateStepper(rawStatus, hasPlan = false) {
    const stepper = document.getElementById('task-stepper');
    if (!stepper) return;

    let stage = rawStatus || 'routed';
    if (stage === 'routed' && hasPlan) {
      stage = 'planned';
    }

    const steps = ['routed', 'planned', 'running', 'done'];
    const currentIndex = steps.indexOf(stage);

    stepper.querySelectorAll('.step').forEach((el) => {
      const stepName = el.dataset.step;
      const stepIndex = steps.indexOf(stepName);
      const numEl = el.querySelector('.step-num');

      el.classList.remove('active', 'completed', 'blocked');

      if (stage === 'blocked') {
        if (stepName === 'routed') {
          el.classList.add('blocked');
          if (numEl) numEl.textContent = '!';
        } else if (numEl) {
          numEl.textContent = String(stepIndex + 1);
        }
        return;
      }

      if (currentIndex >= 0 && stepIndex < currentIndex) {
        el.classList.add('completed');
        if (numEl) numEl.textContent = '✓';
      } else if (stepIndex === currentIndex) {
        el.classList.add('active');
        if (numEl) numEl.textContent = stage === 'done' ? '✓' : String(stepIndex + 1);
      } else {
        if (numEl) numEl.textContent = String(stepIndex + 1);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Router Chip: Gemma | Ollama | Rules
  // ---------------------------------------------------------------------------
  function updateRouterChip(activeTier) {
    const chip = document.getElementById('router-chip');
    if (!chip) return;
    chip.querySelectorAll('.chip-tier').forEach((el) => {
      if (el.dataset.tier === activeTier) {
        el.classList.add('active');
        el.setAttribute('title', `Active router: ${el.textContent}`);
      } else {
        el.classList.remove('active');
        el.removeAttribute('title');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Task Input & Preview
  // ---------------------------------------------------------------------------
  task.addEventListener('input', () => {
    handoffFallback.hidden = true;
    openHandoffExternal.dataset.target = '';
    vscode.setState({ task: task.value });
    card.hidden = true;
    if (overrideCard) overrideCard.hidden = true;
    requestId++;
    ready = false;
    preview.hidden = true;
    submit.disabled = false;
    refresh.disabled = false;
    setSubmitButtonState('prepare', false);
    status.textContent = '';
    currentTaskId = '';
    controls.replaceChildren();
    taskStatus.textContent = '';
    taskOutcome.textContent = '';
    planSection.hidden = true;
    planText.value = '';
    planStatus.textContent = '';
    pendingAutoRoute = false;
  });

  function updatePreview() {
    const text = parts.filter((part) => selected.has(part.source)).map((part) => part.text).join('\n\n');
    document.getElementById('context-text').textContent = text.slice(0, limit);
    document.getElementById('context-size').textContent =
      `${Math.min(text.length, limit)} context characters will be shared` +
      (text.length > limit ? ` (trimmed from ${text.length}).` : '.');
  }

  function prepareContext() {
    if (!task.value.trim()) {
      showToast('Please enter a coding task before routing.', 'warning', 3000);
      return;
    }
    ready = false;
    preview.hidden = true;
    submit.disabled = true;
    refresh.disabled = true;
    card.hidden = true;
    if (overrideCard) overrideCard.hidden = true;
    setSubmitButtonState('prepare', true);
    status.innerHTML = '<span class="spinner"></span> Preparing local context…';
    vscode.postMessage({ type: 'previewContext', text: task.value, requestId: ++requestId });
  }

  refresh.addEventListener('click', prepareContext);

  // ---------------------------------------------------------------------------
  // Voice Input
  // ---------------------------------------------------------------------------
  if (micBtn) {
    micBtn.removeAttribute('title');
    micBtn.addEventListener('click', () => {
      micBtn.disabled = true;
      micBtn.classList.add('recording');
      micBtn.setAttribute('data-tooltip', 'Recording speech…');
      micBtn.setAttribute('aria-label', 'Recording speech…');
      status.innerHTML = '<span class="spinner"></span> Opening recorder in VS Code…';
      vscode.postMessage({ type: 'startVoiceRecorder' });
    });
  }

  // ---------------------------------------------------------------------------
  // Form Submission
  // ---------------------------------------------------------------------------
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const promptText = task.value.trim();
    if (!promptText || submit.disabled) {
      if (!promptText) {
        showToast('Please enter a coding task before routing.', 'warning');
      }
      return;
    }

    if (chatMessages && promptText) {
      const userTurn = document.createElement('div');
      userTurn.className = 'user-message-turn';
      const bubble = document.createElement('div');
      bubble.className = 'user-message-bubble';
      bubble.textContent = promptText;
      const meta = document.createElement('div');
      meta.className = 'user-turn-meta';
      meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      userTurn.append(bubble, meta);
      chatMessages.appendChild(userTurn);
      if (heroState) heroState.style.display = 'none';
      userTurn.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    if (!ready) {
      prepareContext();
      return;
    }
    submit.disabled = true;
    refresh.disabled = true;
    sourceList.querySelectorAll('input').forEach((input) => { input.disabled = true; });
    card.hidden = true;
    if (overrideCard) overrideCard.hidden = true;
    setSubmitButtonState('route', true);
    status.innerHTML = '<span class="spinner"></span> Routing task via Gemma…';
    resourcesManager?.setSearching(promptText);
    vscode.postMessage({ type: 'routeTask', text: promptText, requestId, sources: [...selected] });
  });

  // ---------------------------------------------------------------------------
  // Message Handling
  // ---------------------------------------------------------------------------
  window.addEventListener('message', ({ data }) => {
    if (data?.type === 'resourcesSearching') {
      resourcesManager?.setSearching(data.query);
      return;
    }
    if (data?.type === 'resourcesReady') {
      setSidebarCollapsed(false);
      resourcesManager?.renderResources(data.resources);
      return;
    }
    if (data?.type === 'activeSession') {
      const session = data.session;
      if (sessionChip) {
        sessionChip.textContent = session?.title || 'New session';
      }
      if (chatMessages) {
        chatMessages.replaceChildren();
      }
      card.hidden = true;
      if (session?.title && session.title !== 'New session') {
        if (heroState) heroState.style.display = 'none';
      } else {
        if (heroState) heroState.style.display = 'flex';
        resourcesManager?.renderResources({
          tier: 'keyword',
          videos: [],
          blogs: [],
          artifacts: [],
          notice: 'Related YouTube tutorials, blogs, and documentation resources will appear here as you prompt Baton.',
        });
      }
      if (session?.turns && session.turns.length > 0) {
        session.turns.forEach((turn) => {
          if (turn.role === 'user') {
            const userTurn = document.createElement('div');
            userTurn.className = 'user-message-turn';
            const bubble = document.createElement('div');
            bubble.className = 'user-message-bubble';
            bubble.textContent = turn.content;
            userTurn.append(bubble);
            chatMessages.appendChild(userTurn);
          }
        });
      }
      return;
    }
    if (data?.type === 'personalKeysStatus') {
      for (const provider of ['gemma', 'elevenlabs']) {
        const configured = data.configured?.[provider] === true;
        document.getElementById(`${provider}-key-status`).textContent = configured
          ? 'Your key is active' : 'Using default if available';
        document.querySelector(`.remove-key[data-provider="${provider}"]`).disabled = !configured;
      }
      settingsStatus.textContent = data.notice || '';
      if (data.notice) showToast(data.notice, data.notice.startsWith('Could not') ? 'error' : 'success');
      return;
    }
    if (data?.type === 'handoffResult') {
      planStatus.textContent = data.notice || '';
      showToast(data.notice || 'Prompt ready.', 'info', 4000);
      openHandoffExternal.dataset.target = data.externalTarget || '';
      handoffFallback.hidden = !data.externalTarget;
      return;
    }
    if (data?.type === 'handoffExternalResult') {
      showToast(data.notice || 'Opened externally.', 'info', 3500);
      return;
    }
    if (data?.type === 'voiceRecorderReady') {
      status.textContent = 'Recorder opened in VS Code. Click Start Recording in that tab.';
      return;
    }
    if (data?.type === 'voiceTranscribing') {
      status.innerHTML = '<span class="spinner"></span> Transcribing speech…';
      return;
    }
    if (data?.type === 'mcpStatus') {
      mcpBtn.disabled = false;
      mcpBtn.textContent = data.running ? 'Stop MCP' : 'Start MCP';
      mcpBtn.title = data.running ? 'Stop the Baton MCP server' : 'Start the Baton MCP server';
      mcpConnection.hidden = !data.running;
      mcpEndpoint.textContent = data.running ? `${data.command} "${data.endpoint}"` : '';
      if (data.notice) showToast(data.notice, data.running ? 'success' : 'info', 3500);
      return;
    }
    if (data?.type === 'taskActionResult') {
      if (data.taskId === currentTaskId) {
        taskStatus.textContent = data.notice;
        showToast(data.notice, 'info', 3500);
      }
      return;
    }

    if (data?.type === 'history') {
      const current = data.tasks.find((entry) => entry.id === currentTaskId);
      if (current) {
        taskActions.render(controls, current);
        taskOutcome.textContent = `Status: ${current.status}` + (current.outcome ? ` · Outcome: ${current.outcome}` : '');
        updateStepper(current.status, Boolean(current.plan));
      }
      if (data.changed) {
        ready = false;
        preview.hidden = true;
        setSubmitButtonState('prepare', false);
      }
      return;
    }

    if (data?.type === 'voiceText') {
      if (micBtn) {
        micBtn.disabled = false;
        micBtn.classList.remove('recording');
        micBtn.setAttribute('data-tooltip', 'Speak task (ElevenLabs Voice Input)');
        micBtn.setAttribute('aria-label', 'Speak task (ElevenLabs Voice Input)');
        micBtn.removeAttribute('title');
      }
      const spoken = (data.text || '').trim();
      if (spoken) {
        task.value = spoken;
        task.dispatchEvent(new Event('input'));
        status.textContent = `Transcribed: "${spoken}"`;
        showToast(`Transcribed: "${spoken}"`, 'success', 2500);
        if (data.autoRoute) {
          pendingAutoRoute = true;
          status.innerHTML = `<span class="spinner"></span> Auto-routing: "${spoken}"…`;
          form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      } else {
        status.textContent = 'No speech detected.';
        showToast('No speech detected.', 'warning');
      }
      return;
    }

    if (data?.type === 'voiceError') {
      if (micBtn) {
        micBtn.disabled = false;
        micBtn.classList.remove('recording');
        micBtn.setAttribute('data-tooltip', 'Speak task (ElevenLabs Voice Input)');
        micBtn.setAttribute('aria-label', 'Speak task (ElevenLabs Voice Input)');
        micBtn.removeAttribute('title');
      }
      const msg = data.message || 'Voice transcription error.';
      status.textContent = msg;
      showToast(msg, msg.includes('cancelled') ? 'info' : 'error');
      return;
    }

    if (data?.type === 'clipboardContent') {
      if (typeof data.text === 'string' && data.text) {
        planText.value = data.text;
        planStatus.textContent = 'Clipboard content pasted.';
        showToast('Plan pasted from clipboard.', 'success', 2500);
      } else {
        planStatus.textContent = 'Clipboard was empty.';
        showToast('Clipboard was empty.', 'warning', 2500);
      }
      return;
    }

    if (data?.type === 'planSaved') {
      savePlanBtn.disabled = false;
      savePlanBtn.innerHTML = '💾 Save plan';
      planStatus.textContent = data.notice ?? 'Plan saved to memory.';
      showToast(data.notice ?? 'Plan saved to memory.', 'success', 3500);
      updateStepper('planned', true);
      ready = false;
      preview.hidden = true;
      setSubmitButtonState('prepare', false);
      return;
    }

    if (data?.type === 'planSaveError') {
      savePlanBtn.disabled = false;
      savePlanBtn.innerHTML = '💾 Save plan';
      const msg = data.message ?? 'Could not save plan.';
      planStatus.textContent = msg;
      showToast(msg, 'error');
      return;
    }

    if (data?.requestId !== requestId) return;

    if (data.type === 'contextPreview') {
      parts = data.parts;
      limit = data.limit;
      selected.clear();
      sourceList.replaceChildren();
      for (const part of parts) {
        selected.add(part.source);
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(part.source);
          else selected.delete(part.source);
          card.hidden = true;
          if (overrideCard) overrideCard.hidden = true;
          updatePreview();
        });
        label.append(checkbox, document.createTextNode(` ${part.source} — ${part.text.length} chars`));
        sourceList.append(label);
      }
      if (!parts.length) sourceList.textContent = 'No eligible context sources. Only your task will be shared.';
      ready = true;
      submit.disabled = false;
      refresh.disabled = false;
      setSubmitButtonState('route', false);
      preview.hidden = false;
      preview.open = true;
      status.textContent = 'Review the sources, then route your task.';
      updatePreview();
      if (pendingAutoRoute) {
        pendingAutoRoute = false;
        form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
      return;
    }

    refresh.disabled = false;
    sourceList.querySelectorAll('input').forEach((input) => { input.disabled = false; });

    if (data?.type === 'routeError') {
      submit.disabled = false;
      setSubmitButtonState(ready ? 'route' : 'prepare', false);
      status.textContent = 'Could not prepare or route this task. Please try again.';
      showToast('Could not route this task. Check connection or try again.', 'error');
      return;
    }

    if (data?.type !== 'routed' || !data.decision?.route) return;

    currentTaskId = data.taskId || '';
    vscode.postMessage({ type: 'handoffAvailabilityRequest' });
    submit.disabled = false;
    setSubmitButtonState('route', false);
    status.textContent = (data.saved ? 'Saved to memory. Choose a destination below.'
      : 'Route ready, but local memory could not be saved.') + (data.notice ? ` ${data.notice}` : '');

    if (data.text !== task.value) return;

    const { route, action, why } = data.decision;
    taskStatus.textContent = '';
    taskOutcome.textContent = '';
    taskActions.render(controls, {
      id: currentTaskId,
      route,
      decision: action,
      status: action === 'BLOCK' ? 'blocked' : 'routed',
      saved: data.saved,
    });

    if (!['low', 'moderate', 'high'].includes(route.risk_tier)) return;

    // Risk badge
    const risk = document.getElementById('risk');
    risk.textContent = `${route.risk_tier} risk`;
    risk.className = `risk risk-${route.risk_tier}`;

    // Route details
    document.getElementById('route-type').textContent = route.task_type;
    document.getElementById('destination').textContent = route.recommended_destination;
    document.getElementById('research').textContent = route.research_needed ? 'Yes' : 'No';
    document.getElementById('reason').textContent = route.reason;
    document.getElementById('action').textContent = action;
    document.getElementById('policy-why').textContent = why;

    const routerTierEl = document.getElementById('router-tier');
    if (routerTierEl) routerTierEl.textContent = tiers[data.tier] ?? '';
    const routerNotice = document.getElementById('router-notice');
    routerNotice.textContent = data.notice || '';
    routerNotice.hidden = !data.notice;

    // Small "Router: Gemma | Ollama | Rules" chip
    updateRouterChip(data.tier);

    // Status stepper (Routed > Planned > Running > Done)
    updateStepper(action === 'BLOCK' ? 'blocked' : 'routed', false);

    // Visible "Policy overrode the model" note when policy raised risk
    const isOverride = Boolean(data.decision?.overrode)
      || /danger\s+keyword\s+raised\s+risk/i.test(why)
      || /raised\s+risk/i.test(why);

    if (overrideCard) {
      if (isOverride) {
        overrideCard.hidden = false;
        if (overrideText) {
          overrideText.textContent = why || 'Risk elevated to high by safety policy. Manual handling required; never auto-run.';
        }
      } else {
        overrideCard.hidden = true;
      }
    }

    card.hidden = false;
    planSection.hidden = false;

    if (action === 'BLOCK') {
      showToast('Task blocked by policy. Enter a valid coding task.', 'warning');
    } else if (isOverride) {
      showToast('Policy overrode the model: risk elevated to high.', 'warning', 4500);
    } else {
      showToast(`Routed via ${tiers[data.tier] ?? data.tier}. Risk: ${route.risk_tier}.`, 'info', 3000);
    }
  });

  useClipboardBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'readClipboard' });
  });

  savePlanBtn.addEventListener('click', () => {
    if (!currentTaskId) {
      planStatus.textContent = 'Route a task first.';
      showToast('Route a task first.', 'warning');
      return;
    }
    const plan = planText.value.trim();
    if (!plan) {
      planStatus.textContent = 'Paste a plan first.';
      showToast('Paste a plan first.', 'warning');
      return;
    }
    if (new TextEncoder().encode(plan).length > 100 * 1024) {
      planStatus.textContent = 'Keep the plan under 100 KB.';
      showToast('Keep the plan under 100 KB.', 'error');
      return;
    }
    savePlanBtn.disabled = true;
    savePlanBtn.innerHTML = '<span class="spinner"></span> Saving…';
    planStatus.innerHTML = '<span class="spinner"></span> Saving plan…';
    vscode.postMessage({ type: 'savePlan', taskId: currentTaskId, plan });
  });
  vscode.postMessage({ type: 'handoffAvailabilityRequest' });
})();
