(() => {
  const vscode = acquireVsCodeApi();
  const taskActions = initializeTaskActions(vscode);
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

  let requestId = 0;
  let pendingPreview = null;
  let hasProject = true;
  let activePlanTextarea = null;
  const selected = new Set();
  const tiers = { gemma: 'via Google AI Studio', ollama: 'via Ollama Cloud', rules: 'via rules' };

  const SEND_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';
  const SPINNER_ICON_SVG = '<svg class="dock-btn-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" stroke-opacity="0.25"></circle><path d="M12 3a9 9 0 0 1 9 9"></path></svg>';
  const BATON_LOGO_SVG = '<svg class="assistant-turn-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 16 10-10a2.12 2.12 0 0 1 3 3L9 19a2.12 2.12 0 0 1-3-3Z"/><path d="m13 9 3 3M5 5v4M3 7h4"/></svg>';

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

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
    task.value = vscode.getState()?.task ?? '';

    function autoResize() {
      task.style.height = 'auto';
      task.style.height = `${Math.min(Math.max(task.scrollHeight, 38), 160)}px`;
    }

    task.addEventListener('input', () => {
      autoResize();
      vscode.setState({ task: task.value });
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
      task.style.height = 'auto';
      task.style.height = `${Math.min(Math.max(task.scrollHeight, 38), 160)}px`;
      task.focus();
    });
  });

  if (newSessionHeaderBtn) {
    newSessionHeaderBtn.addEventListener('click', () => {
      if (!hasProject) {
        showToast('Please open or create a project first before creating tasks.', 'warning');
        return;
      }
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
  // Turn Stepper Helper
  // ---------------------------------------------------------------------------
  function updateTurnStepper(stepperEl, rawStatus, hasPlan = false) {
    if (!stepperEl) return;
    let stage = rawStatus || 'routed';
    if (stage === 'routed' && hasPlan) {
      stage = 'planned';
    }

    const steps = ['routed', 'planned', 'running', 'done'];
    const currentIndex = steps.indexOf(stage);

    stepperEl.querySelectorAll('.step').forEach((el) => {
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
  // KB & Recommendation Handlers
  // ---------------------------------------------------------------------------
  function populateWhySection(section, route) {
    const whyTextEl = section.querySelector('.why-text');
    const whySourcesEl = section.querySelector('.why-sources');
    const claims = route.kb_claims || [];
    const codingRoute = ['codex', 'antigravity', 'copilot'].includes(route.recommended_destination);
    whyTextEl.textContent = [
      route.reason ? `Router: ${route.reason}` : '',
      claims.length
        ? claims.map((claim, i) => `${i + 1}. ${claim.text}`).join('\n')
        : codingRoute
          ? 'No verified knowledge-base claims support this model yet. Refresh knowledge to check the listed sources.'
          : 'This web destination was chosen by the router; model knowledge-base claims do not apply.',
    ].filter(Boolean).join('\n\n');
    claims.forEach((claim, i) => {
      try {
        const url = new URL(claim.source_url);
        if (url.protocol !== 'https:') return;
        const link = document.createElement('a');
        link.href = url.href;
        link.textContent = `Source ${i + 1}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        whySourcesEl.append(link, document.createTextNode(' '));
      } catch { /* Invalid source URL is not linked. */ }
    });
  }

  function handleRefreshKB() {
    showToast('Refreshing knowledge base…', 'info', 3000);
    vscode.postMessage({ type: 'baton.kb.update' });
  }

  function handleOpenSources() {
    vscode.postMessage({ type: 'baton.kb.openSources' });
  }

  // ---------------------------------------------------------------------------
  // Chat Turn Creation & Rendering
  // ---------------------------------------------------------------------------
  function appendUserMessage(text, isoTime) {
    if (!chatMessages) return null;
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

  function renderAssistantTurn(turnEl, data) {
    turnEl.replaceChildren();
    const taskId = data.taskId || '';
    turnEl.dataset.taskId = taskId;

    const route = data.route || data.decision?.route || {};
    const action = data.decision?.action || data.decision || 'MANUAL_ONLY';
    const why = data.decision?.why || data.why || '';
    const tier = data.tier || data.routerTier || 'gemma';
    const riskTier = route.risk_tier || 'moderate';
    const codingRoute = ['codex', 'antigravity', 'copilot'].includes(route.recommended_destination);

    // Compute whether the KB has docs-verified claims
    const hasDocsOrigin = route.kb_docs_verified === true || route.kb_claims?.some((claim) => claim.origin === 'docs');

    // Header
    const header = document.createElement('div');
    header.className = 'assistant-turn-header';
    header.innerHTML = `
      ${BATON_LOGO_SVG}
      <span class="assistant-turn-name">Baton Router</span>
      <div class="router-chip" title="The selected provider runs first; the other provider and rules are fallbacks.">
        <span class="router-chip-label">Router:</span>
        <span class="chip-tier chip-gemma ${tier === 'gemma' ? 'active' : ''}">AI Studio</span>
        <span class="chip-sep">|</span>
        <span class="chip-tier chip-ollama ${tier === 'ollama' ? 'active' : ''}">Ollama Cloud</span>
        <span class="chip-sep">|</span>
        <span class="chip-tier chip-rules ${tier === 'rules' ? 'active' : ''}">Rules</span>
      </div>
      <span class="risk risk-${riskTier}">${riskTier} risk</span>
      <span class="assistant-turn-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    `;

    // Route Card
    const card = document.createElement('article');
    card.className = 'route-card';

    // Stepper
    const stepperWrap = document.createElement('div');
    stepperWrap.className = 'stepper-wrap';
    stepperWrap.innerHTML = `
      <nav class="stepper" aria-label="Task progress">
        <div class="step" data-step="routed">
          <span class="step-num">1</span>
          <span class="step-name">Routed</span>
        </div>
        <span class="step-arrow" aria-hidden="true">›</span>
        <div class="step" data-step="planned">
          <span class="step-num">2</span>
          <span class="step-name">Planned</span>
        </div>
        <span class="step-arrow" aria-hidden="true">›</span>
        <div class="step" data-step="running">
          <span class="step-num">3</span>
          <span class="step-name">Running</span>
        </div>
        <span class="step-arrow" aria-hidden="true">›</span>
        <div class="step" data-step="done">
          <span class="step-num">4</span>
          <span class="step-name">Done</span>
        </div>
      </nav>
    `;
    updateTurnStepper(stepperWrap.querySelector('.stepper'), data.status || (action === 'BLOCK' ? 'blocked' : 'routed'), Boolean(data.plan));
    card.appendChild(stepperWrap);

    // Policy Override Card (if elevated to high)
    const isOverride = Boolean(data.decision?.overrides)
      || Boolean(data.overrides)
      || /danger\s+keyword\s+raised\s+risk/i.test(why)
      || /raised\s+risk/i.test(why);

    if (isOverride) {
      const overrideCard = document.createElement('div');
      overrideCard.className = 'policy-override-card';
      overrideCard.innerHTML = `
        <div class="override-header">
          <span class="override-icon" aria-hidden="true">⚠️</span>
          <strong class="override-title">Policy overrode the model</strong>
        </div>
        <p class="override-body">${escapeHtml(why || 'Risk elevated to high by safety policy. Manual handling required; never auto-run.')}</p>
      `;
      card.appendChild(overrideCard);
    }

    // Route Details Grid
    const grid = document.createElement('dl');
    grid.className = 'route-grid';
    grid.innerHTML = `
      <div class="grid-item">
        <dt>Type</dt>
        <dd>${escapeHtml(route.task_type || '')}</dd>
      </div>
      <div class="grid-item">
        <dt>Destination</dt>
        <dd class="dest-badge">${escapeHtml(route.recommended_destination || '')}</dd>
      </div>
      <div class="grid-item">
        <dt>Research</dt>
        <dd>${route.research_needed ? 'Yes' : 'No'}</dd>
      </div>
      <div class="grid-item">
        <dt>Policy Action</dt>
        <dd class="action-badge">${escapeHtml(action)}</dd>
      </div>
    `;
    card.appendChild(grid);

    // Recommended Card
    const recommendedCard = document.createElement('div');
    recommendedCard.className = 'info-card recommended-card';
    recommendedCard.innerHTML = `
      <span class="info-label">Recommended</span>
      <div class="recommended-info">
        <div class="recommended-agent" title="Agent">${escapeHtml(route.recommended_destination || '')}</div>
        ${route.recommended_model ? `<div class="recommended-model" title="Model">${escapeHtml(route.recommended_model)}</div>` : ''}
        ${route.model_reasoning ? `<div class="reasoning-badge" title="Reasoning Level">${escapeHtml(route.model_reasoning)}</div>` : ''}
        <div class="recommended-reason" title="Routing reason">${escapeHtml(route.reason || '')}</div>
        ${route.kb_note === 'No model data yet' ? '<div class="recommended-reason">Model is listed as available, but has no verified KB facts yet.</div>' : ''}
      </div>
      <div class="recommended-badges">
        ${codingRoute && route.kb_stale ? '<span class="badge badge-stale">Stale</span>' : ''}
        ${hasDocsOrigin ? '<span class="badge badge-docs-verified">Docs-verified</span>' : ''}
        ${codingRoute && !hasDocsOrigin ? '<span class="badge badge-unverified">Unverified</span>' : ''}
      </div>
    `;
    card.appendChild(recommendedCard);

    // Why? Collapsible Section
    const whySection = document.createElement('details');
    whySection.className = 'why-section';
    whySection.innerHTML = `
      <summary class="why-collapsible summary">Why this recommendation?</summary>
      <div class="why-collapsible details">
        <pre class="turn-context-pre why-text"></pre>
        <div class="why-sources"></div>
      </div>
    `;
    card.appendChild(whySection);
    populateWhySection(whySection, route);

    // Refresh knowledge and Open sources buttons
    const kbButtons = document.createElement('div');
    kbButtons.className = 'kb-buttons';
    kbButtons.innerHTML = `
      <button type="button" class="btn-secondary refresh-kb" aria-label="Refresh knowledge">Refresh knowledge</button>
      <button type="button" class="btn-primary open-sources" aria-label="Open sources">Open sources</button>
    `;
    card.appendChild(kbButtons);
    kbButtons.querySelector('.refresh-kb')?.addEventListener('click', handleRefreshKB);
    kbButtons.querySelector('.open-sources')?.addEventListener('click', handleOpenSources);

    // Reasoning Card
    const reasonCard = document.createElement('div');
    reasonCard.className = 'info-card reason-card';
    reasonCard.innerHTML = `
      <span class="info-label">Reasoning</span>
      <p class="info-content">${escapeHtml(route.reason || '')}</p>
    `;
    card.appendChild(reasonCard);

    // Policy Gate Card
    if (why) {
      const policyCard = document.createElement('div');
      policyCard.className = 'info-card policy-card';
      policyCard.innerHTML = `
        <span class="info-label">Policy Gate</span>
        <p class="info-content">${escapeHtml(why)}</p>
      `;
      card.appendChild(policyCard);
    }

    // Collapsible Context Drawer (What was shared)
    const snippet = data.contextSnippet || '';
    if (snippet) {
      const contextDetails = document.createElement('details');
      contextDetails.className = 'turn-context-details';
      contextDetails.innerHTML = `
        <summary>What was shared (${snippet.length} context chars)</summary>
        <div class="turn-context-body">
          <pre class="turn-context-pre">${escapeHtml(snippet)}</pre>
        </div>
      `;
      card.appendChild(contextDetails);
    }

    // Implementation Plan Section
    const planSection = document.createElement('div');
    planSection.className = 'card-section';
    planSection.innerHTML = `
      <div class="section-title">Implementation Plan</div>
      <label class="field-label">Paste Plan</label>
      <textarea class="turn-plan-text" rows="4" placeholder="Paste the implementation plan you received…">${escapeHtml(data.plan || '')}</textarea>
      <div class="plan-actions">
        <button type="button" class="btn-secondary turn-paste-clipboard">📋 Paste clipboard</button>
        <button type="button" class="btn-primary turn-save-plan">💾 Save plan</button>
      </div>
      <p class="status-msg turn-plan-status" role="status" aria-live="polite"></p>
    `;

    const planTextarea = planSection.querySelector('.turn-plan-text');
    const pasteBtn = planSection.querySelector('.turn-paste-clipboard');
    const saveBtn = planSection.querySelector('.turn-save-plan');
    const planStatusEl = planSection.querySelector('.turn-plan-status');

    pasteBtn?.addEventListener('click', () => {
      activePlanTextarea = planTextarea;
      vscode.postMessage({ type: 'readClipboard' });
    });

    saveBtn?.addEventListener('click', () => {
      const planVal = (planTextarea?.value || '').trim();
      if (!taskId) {
        showToast('Route a task first.', 'warning');
        return;
      }
      if (!planVal) {
        if (planStatusEl) planStatusEl.textContent = 'Paste a plan first.';
        showToast('Paste a plan first.', 'warning');
        return;
      }
      if (new TextEncoder().encode(planVal).length > 100 * 1024) {
        if (planStatusEl) planStatusEl.textContent = 'Keep the plan under 100 KB.';
        showToast('Keep the plan under 100 KB.', 'error');
        return;
      }
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner"></span> Saving…';
      if (planStatusEl) planStatusEl.innerHTML = '<span class="spinner"></span> Saving plan…';
      vscode.postMessage({ type: 'savePlan', taskId, plan: planVal });
    });

    card.appendChild(planSection);

    // Run or Open Destination Controls
    const controlsSection = document.createElement('div');
    controlsSection.className = 'card-section';
    controlsSection.innerHTML = `
      <div class="section-title">Run or Open</div>
      <div class="task-controls"></div>
      <p class="status-msg turn-task-status" role="status" aria-live="polite"></p>
      <p class="outcome-msg turn-task-outcome">${data.outcome ? `Outcome: ${escapeHtml(data.outcome)}` : ''}</p>
    `;

    const controlsContainer = controlsSection.querySelector('.task-controls');
    if (controlsContainer) {
      taskActions.render(controlsContainer, {
        id: taskId,
        route,
        decision: action,
        status: data.status || (action === 'BLOCK' ? 'blocked' : 'routed'),
        saved: data.saved !== false,
      });
    }

    card.appendChild(controlsSection);

    turnEl.append(header, card);
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
    const { text, id } = pendingPreview;
    pendingPreview = null;
    if (contextPreview) contextPreview.hidden = true;
    if (task) {
      task.value = '';
      task.style.height = '38px';
      vscode.setState({ task: '' });
    }
    if (heroState) heroState.style.display = 'none';
    appendUserMessage(text, new Date().toISOString());
    appendAssistantLoadingTurn(id, text);
    resourcesManager?.setSearching(text);
    vscode.postMessage({ type: 'routeTask', text, requestId: id, sources: [...selected] });
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

    const reqId = ++requestId;
    pendingPreview = { text: promptText, id: reqId };
    setSubmitButtonState('route', true);
    if (submit) submit.disabled = true;
    vscode.postMessage({ type: 'previewContext', text: promptText, requestId: reqId });
  });

  // ---------------------------------------------------------------------------
  // Extension Message Handling
  // ---------------------------------------------------------------------------
  window.addEventListener('message', ({ data }) => {
    if (!data || typeof data !== 'object') return;

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
        task.disabled = !hasProject;
        task.placeholder = hasProject
          ? 'Ask Baton to edit, route, or build... (Enter to route, Shift+Enter for newline)'
          : 'Please open or create a project first...';
      }
      if (submit) submit.disabled = !hasProject;
      if (micBtn) micBtn.disabled = !hasProject;
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
      if (sessionChip) {
        sessionChip.textContent = session?.title || 'New task';
      }
      if (chatMessages) {
        chatMessages.replaceChildren();
      }

      const turns = session?.turns || [];
      if (turns.length > 0) {
        if (heroState) heroState.style.display = 'none';
        turns.forEach((turn) => {
          if (turn.role === 'user') {
            appendUserMessage(turn.content, turn.createdAt);
          } else if (turn.role === 'assistant') {
            const turnEl = document.createElement('div');
            turnEl.className = 'assistant-turn';
            chatMessages?.appendChild(turnEl);
            renderAssistantTurn(turnEl, {
              taskId: turn.taskId,
              route: turn.route,
              decision: turn.decision,
              routerTier: turn.routerTier,
              status: turn.status,
              plan: turn.plan,
              outcome: turn.outcome,
              contextSnippet: turn.contextSnippet,
              why: turn.why,
              overrode: turn.overrides,
              saved: true,
            });
          }
        });
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
      const turnEl = chatMessages?.querySelector(`[data-task-id="${data.taskId}"]`);
      if (turnEl) {
        const taskStatusEl = turnEl.querySelector('.turn-task-status');
        if (taskStatusEl) taskStatusEl.textContent = data.notice || '';
        showToast(data.notice || 'Action executed.', 'info', 3500);
      }
      return;
    }

    if (data.type === 'history') {
      for (const t of data.tasks || []) {
        const turnEl = chatMessages?.querySelector(`[data-task-id="${t.id}"]`);
        if (turnEl) {
          const outcomeEl = turnEl.querySelector('.turn-task-outcome');
          if (outcomeEl) outcomeEl.textContent = `Status: ${t.status}` + (t.outcome ? ` · Outcome: ${t.outcome}` : '');
          const stepper = turnEl.querySelector('.stepper');
          updateTurnStepper(stepper, t.status, Boolean(t.plan));
        }
      }
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
        vscode.setState({ task: spoken });
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
      const turnEl = chatMessages?.querySelector(`[data-task-id="${data.taskId}"]`);
      if (turnEl) {
        const saveBtn = turnEl.querySelector('.turn-save-plan');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '💾 Save plan';
        }
        const planStatusEl = turnEl.querySelector('.turn-plan-status');
        if (planStatusEl) planStatusEl.textContent = data.notice ?? 'Plan saved to memory.';
        const stepper = turnEl.querySelector('.stepper');
        updateTurnStepper(stepper, 'planned', true);
      }
      showToast(data.notice ?? 'Plan saved to memory.', 'success', 3500);
      return;
    }

    if (data.type === 'planSaveError') {
      const turnEl = chatMessages?.querySelector(`[data-task-id="${data.taskId}"]`);
      if (turnEl) {
        const saveBtn = turnEl.querySelector('.turn-save-plan');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = '💾 Save plan';
        }
        const planStatusEl = turnEl.querySelector('.turn-plan-status');
        if (planStatusEl) planStatusEl.textContent = data.message ?? 'Could not save plan.';
      }
      showToast(data.message ?? 'Could not save plan.', 'error');
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

    if (data.type === 'routed' && data.decision?.route) {
      if (submit) submit.disabled = false;
      setSubmitButtonState('route', false);

      let turnEl = chatMessages?.querySelector(`[data-request-id="${data.requestId}"]`);
      if (!turnEl) {
        // Fallback: create turn element
        turnEl = document.createElement('div');
        turnEl.className = 'assistant-turn';
        chatMessages?.appendChild(turnEl);
      }

      renderAssistantTurn(turnEl, data);
      vscode.postMessage({ type: 'handoffAvailabilityRequest' });

      const action = data.decision?.action;
      const route = data.decision?.route;
      const isOverride = Boolean(data.decision?.overrides)
        || /danger\s+keyword\s+raised\s+risk/i.test(data.decision?.why || '')
        || /raised\s+risk/i.test(data.decision?.why || '');

      if (action === 'BLOCK') {
        showToast('Task blocked by policy. Enter a valid coding task.', 'warning');
      } else if (isOverride) {
        showToast('Policy overrode the model: risk elevated to high.', 'warning', 4500);
      } else {
        showToast(`Routed via ${tiers[data.tier] ?? data.tier}. Risk: ${route.risk_tier}.`, 'info', 3000);
      }
    }
  });

  vscode.postMessage({ type: 'handoffAvailabilityRequest' });
  vscode.postMessage({ type: 'routerSettingsStatus' });
  vscode.postMessage({ type: 'checkProjectState' });
})();
