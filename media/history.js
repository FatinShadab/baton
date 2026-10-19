function initializeHistory(vscode, taskActions) {
  const tabs = [
    document.getElementById('task-tab'),
    document.getElementById('history-tab'),
    document.getElementById('settings-tab'),
    document.getElementById('mcp-tab')
  ].filter(Boolean);
  const pane = document.getElementById('history-pane');
  const list = document.getElementById('history-list');
  const status = document.getElementById('history-status');
  const project = document.getElementById('history-project');
  const refresh = document.getElementById('refresh-history');
  const expanded = new Set();
  const drafts = new Map();
  let busy = false;
  const tiers = { gemma: 'Gemma', ollama: 'Ollama', rules: 'Rules' };

  function notify(msg, type = 'info') {
    if (typeof window.showBatonToast === 'function') {
      window.showBatonToast(msg, type);
    }
  }

  function send(message) {
    if (busy) return;
    busy = true;
    pane.querySelectorAll('button, textarea').forEach((input) => { input.disabled = true; });
    status.innerHTML = message.type === 'loadHistory'
      ? '<span class="spinner"></span> Loading history…'
      : '<span class="spinner"></span> Saving…';
    vscode.postMessage(message);
  }

  function loadHistory() {
    send({ type: 'loadHistory' });
  }

  function show(index) {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      const target = document.getElementById(tab.getAttribute('aria-controls'));
      if (target) target.hidden = i !== index;
    });
    if (index === 1) {
      vscode.postMessage({ type: 'handoffAvailabilityRequest' });
      loadHistory();
    } else if (index === 2) {
      vscode.postMessage({ type: 'personalKeysStatus' });
    } else if (index === 3) {
      vscode.postMessage({ type: 'mcpStatusRequest' });
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => show(index));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      show(next);
      tabs[next].focus();
    });
  });

  refresh.addEventListener('click', loadHistory);

  function render(tasks) {
    list.replaceChildren();
    if (!tasks.length) {
      list.textContent = project.textContent
        ? 'No tasks recorded for this project yet.' : 'Open a project to view its history.';
      return;
    }
    for (const task of tasks) {
      const details = document.createElement('details');
      details.className = 'history-entry';
      details.open = expanded.has(task.id);
      details.addEventListener('toggle', () => {
        if (details.open) expanded.add(task.id);
        else expanded.delete(task.id);
      });

      const summary = document.createElement('summary');
      const timeStr = new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      summary.innerHTML = `<span class="risk risk-${task.route.risk_tier}">${task.route.risk_tier}</span> ` +
        `<strong>${task.text}</strong>\n` +
        `<span class="context-intro">${timeStr} · Router: ${tiers[task.routerTier] ?? task.routerTier} · Status: ${task.status}</span>`;

      const info = document.createElement('p');
      info.textContent = `${task.route.task_type} → ${task.route.recommended_destination}\n` +
        `Research needed: ${task.route.research_needed ? 'Yes' : 'No'}\n` +
        `Reason: ${task.route.reason}\n` +
        `Decision: ${task.decision}`;
      details.append(summary, info);

      if (task.changedFiles || task.status === 'done') {
        const files = document.createElement('p');
        files.textContent = `Changed files:\n${task.changedFiles?.join('\n') || (task.changedFiles ? '(none)' : '(unavailable)')}`;
        details.append(files);
      }
      if (task.outcome) {
        const outcome = document.createElement('p');
        outcome.textContent = `Outcome: ${task.outcome}`;
        details.append(outcome);
      }
      if (task.approvals?.length) {
        const approval = document.createElement('p');
        approval.textContent = `Approved: ${task.approvals.map((entry) => new Date(entry.approvedAt).toLocaleString()).join(', ')}`;
        details.append(approval);
      }

      if (drafts.get(task.id)?.plan === task.plan) drafts.delete(task.id);
      const draft = drafts.get(task.id) ?? { plan: task.plan ?? '' };

      function field(name, caption) {
        const label = document.createElement('label');
        label.textContent = caption;
        const input = document.createElement('textarea');
        input.rows = name === 'plan' ? 6 : 3;
        input.value = draft[name];
        input.addEventListener('input', () => { draft[name] = input.value; drafts.set(task.id, draft); });
        label.append(input);
        details.append(label);
        return input;
      }

      const plan = field('plan', 'Plan');
      const importButton = document.createElement('button');
      importButton.type = 'button';
      importButton.className = 'btn-secondary';
      importButton.textContent = '📥 Import plan to memory';
      importButton.addEventListener('click', () => {
        if (!plan.value.trim()) {
          notify('Paste a plan first.', 'warning');
          status.textContent = 'Paste a plan first.';
          return;
        }
        if (new TextEncoder().encode(plan.value).length > 100 * 1024) {
          notify('Keep the plan under 100 KB.', 'warning');
          status.textContent = 'Keep the plan under 100 KB.';
          return;
        }
        send({ type: 'importPlan', taskId: task.id, plan: plan.value });
      });
      details.append(importButton);

      const controls = document.createElement('div');
      controls.className = 'task-controls';
      details.append(controls);
      list.append(details);
      taskActions.render(controls, task);
    }
  }

  window.addEventListener('message', ({ data }) => {
    if (data?.type === 'taskActionResult') {
      status.textContent = data.notice;
      notify(data.notice, 'info');
      return;
    }
    if (data?.type !== 'history' && data?.type !== 'historyError') return;
    busy = false;
    pane.querySelectorAll('button, textarea').forEach((input) => { input.disabled = false; });
    if (data.type === 'historyError') {
      status.textContent = data.message;
      notify(data.message, 'error');
      taskActions.update();
      return;
    }
    project.textContent = data.projectName ? `Project: ${data.projectName}` : '';
    render(data.tasks);
    if (data.notice) {
      status.textContent = data.notice;
      notify(data.notice, 'success');
    } else if (status.textContent.includes('Loading history')) {
      status.textContent = '';
    }
  });
}
