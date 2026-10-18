function initializeHistory(vscode) {
  const tabs = [document.getElementById('task-tab'), document.getElementById('history-tab')];
  const pane = document.getElementById('history-pane');
  const list = document.getElementById('history-list');
  const status = document.getElementById('history-status');
  const refresh = document.getElementById('refresh-history');
  const expanded = new Set();
  const drafts = new Map();
  let busy = false;
  const tiers = { gemma: 'Gemma (AI Studio)', ollama: 'Ollama', rules: 'rules' };

  function send(message) {
    if (busy) return;
    busy = true;
    pane.querySelectorAll('button, textarea').forEach((input) => { input.disabled = true; });
    status.textContent = message.type === 'loadHistory' ? 'Loading history…' : 'Saving…';
    vscode.postMessage(message);
  }
  function show(index) {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = i !== index;
    });
    if (index === 1) send({ type: 'loadHistory' });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => show(index));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
      show(next);
      tabs[next].focus();
    });
  });
  refresh.addEventListener('click', () => send({ type: 'loadHistory' }));

  function render(tasks) {
    list.replaceChildren();
    if (!tasks.length) list.textContent = 'No tasks yet. Route a task to start your history.';
    for (const task of tasks) {
      const details = document.createElement('details');
      details.className = 'history-entry';
      details.open = expanded.has(task.id);
      details.addEventListener('toggle', () => {
        if (details.open) expanded.add(task.id);
        else expanded.delete(task.id);
      });
      const summary = document.createElement('summary');
      summary.textContent = `${new Date(task.createdAt).toLocaleString()} · ${task.text}\n` +
        `${task.route.risk_tier} risk · ${tiers[task.routerTier] ?? task.routerTier} · ${task.status}`;
      const info = document.createElement('p');
      info.textContent = `${task.route.task_type} → ${task.route.recommended_destination}\n` +
        `Research needed: ${task.route.research_needed ? 'Yes' : 'No'}\n${task.route.reason}\nDecision: ${task.decision}`;
      details.append(summary, info);
      if (task.changedFiles?.length) {
        const files = document.createElement('p');
        files.textContent = `Changed files:\n${task.changedFiles.join('\n')}`;
        details.append(files);
      }
      const draft = drafts.get(task.id) ?? { plan: task.plan ?? '', outcome: task.outcome ?? '' };
      drafts.set(task.id, draft);
      function field(name, caption) {
        const label = document.createElement('label');
        label.textContent = caption;
        const input = document.createElement('textarea');
        input.rows = name === 'plan' ? 6 : 3;
        input.value = draft[name];
        input.addEventListener('input', () => { draft[name] = input.value; });
        label.append(input);
        details.append(label);
        return input;
      }
      const plan = field('plan', 'Plan');
      const importButton = document.createElement('button');
      importButton.type = 'button';
      importButton.textContent = 'Import plan';
      importButton.addEventListener('click', () => {
        if (!plan.value.trim()) { status.textContent = 'Paste a plan first.'; return; }
        if (new TextEncoder().encode(plan.value).length > 100 * 1024) {
          status.textContent = 'Keep the plan under 100 KB.'; return;
        }
        send({ type: 'importPlan', taskId: task.id, plan: plan.value });
      });
      details.append(importButton);
      const outcome = field('outcome', 'Outcome (optional)');
      if (task.status !== 'blocked') {
        const complete = document.createElement('button');
        complete.type = 'button';
        complete.textContent = task.status === 'done' ? 'Save outcome' : 'Mark complete';
        complete.addEventListener('click', () => {
          if (new TextEncoder().encode(outcome.value).length > 100 * 1024) {
            status.textContent = 'Keep the outcome under 100 KB.'; return;
          }
          send({ type: 'completeTask', taskId: task.id, outcome: outcome.value });
        });
        details.append(complete);
      }
      list.append(details);
    }
  }

  window.addEventListener('message', ({ data }) => {
    if (data?.type !== 'history' && data?.type !== 'historyError') return;
    busy = false;
    pane.querySelectorAll('button, textarea').forEach((input) => { input.disabled = false; });
    if (data.type === 'historyError') { status.textContent = data.message; return; }
    render(data.tasks);
    status.textContent = data.notice ?? '';
  });
}
