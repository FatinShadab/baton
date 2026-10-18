(() => {
  const vscode = acquireVsCodeApi();
  initializeHistory(vscode);
  const form = document.getElementById('task-form');
  const task = document.getElementById('task');
  const card = document.getElementById('route-card');
  const submit = form.querySelector('button[type="submit"]');
  const status = document.getElementById('routing-status');
  const preview = document.getElementById('context-preview');
  const sourceList = document.getElementById('context-sources');
  const refresh = document.getElementById('refresh-context');
  let requestId = 0;
  let ready = false;
  let parts = [];
  let limit = 6000;
  const selected = new Set();
  const tiers = { gemma: 'via Gemma (AI Studio)', ollama: 'via Ollama', rules: 'via rules' };
  task.value = vscode.getState()?.task ?? '';

  task.addEventListener('input', () => {
    vscode.setState({ task: task.value });
    card.hidden = true;
    requestId++;
    ready = false;
    preview.hidden = true;
    submit.disabled = false;
    refresh.disabled = false;
    submit.textContent = 'Prepare context';
    status.textContent = '';
  });

  function updatePreview() {
    const text = parts.filter((part) => selected.has(part.source)).map((part) => part.text).join('\n\n');
    document.getElementById('context-text').textContent = text.slice(0, limit);
    document.getElementById('context-size').textContent =
      `${Math.min(text.length, limit)} context characters will be shared` +
      (text.length > limit ? ` (trimmed from ${text.length}).` : '.');
  }

  function prepareContext() {
    if (!task.value.trim()) return;
    ready = false;
    preview.hidden = true;
    submit.disabled = true;
    refresh.disabled = true;
    card.hidden = true;
    status.textContent = 'Preparing local context…';
    vscode.postMessage({ type: 'previewContext', text: task.value, requestId: ++requestId });
  }
  refresh.addEventListener('click', prepareContext);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!task.value.trim() || submit.disabled) return;
    if (!ready) {
      prepareContext();
      return;
    }
    submit.disabled = true;
    refresh.disabled = true;
    sourceList.querySelectorAll('input').forEach((input) => { input.disabled = true; });
    card.hidden = true;
    status.textContent = 'Routing task…';
    vscode.postMessage({ type: 'routeTask', text: task.value, requestId, sources: [...selected] });
  });
  window.addEventListener('message', ({ data }) => {
    if (data?.type === 'history' && data.changed) {
      // A newly imported plan must be included in a fresh context snapshot.
      task.dispatchEvent(new Event('input'));
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
          updatePreview();
        });
        label.append(checkbox, document.createTextNode(` ${part.source} — ${part.text.length} chars`));
        sourceList.append(label);
      }
      if (!parts.length) sourceList.textContent = 'No eligible context sources. Only your task will be shared.';
      ready = true;
      submit.disabled = false;
      refresh.disabled = false;
      submit.textContent = 'Route task';
      preview.hidden = false;
      preview.open = true;
      status.textContent = 'Review the sources, then route your task.';
      updatePreview();
      return;
    }
    refresh.disabled = false;
    sourceList.querySelectorAll('input').forEach((input) => { input.disabled = false; });
    if (data?.type === 'routeError') {
      submit.disabled = false;
      status.textContent = 'Could not prepare or route this task. Please try again.';
      return;
    }
    if (data?.type !== 'routed' || !data.decision?.route) return;
    submit.disabled = false;
    status.textContent = data.saved ? 'Saved. Open History to import a plan or mark this task complete.'
      : 'Route ready, but local memory could not be saved.';
    if (data.text !== task.value) return;
    const { route, action, why } = data.decision;
    if (!['low', 'moderate', 'high'].includes(route.risk_tier)) return;
    const risk = document.getElementById('risk');
    risk.textContent = route.risk_tier;
    risk.className = `risk risk-${route.risk_tier}`;
    document.getElementById('route-type').textContent = route.task_type;
    document.getElementById('destination').textContent = route.recommended_destination;
    document.getElementById('research').textContent = route.research_needed ? 'Yes' : 'No';
    document.getElementById('reason').textContent = route.reason;
    document.getElementById('action').textContent = action;
    document.getElementById('policy-why').textContent = why;
    document.getElementById('router-tier').textContent = tiers[data.tier] ?? '';
    card.hidden = false;
  });
})();
