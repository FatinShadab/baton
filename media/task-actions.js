// One destination control is shared by the Route Result and History cards.
function initializeTaskActions(vscode) {
  const pending = new Set();
  const controls = new Map();
  const selected = new Map();
  let installed = {};

  function optionsFor(task) {
    const options = [];
    if (installed.codex && task.saved !== false && ['RUN', 'CONFIRM'].includes(task.decision)
      && task.route?.risk_tier !== 'high' && !['running', 'done', 'blocked'].includes(task.status)) {
      options.push(['codex', 'Codex CLI — run task']);
    }
    options.push(['chatgpt', 'ChatGPT — open in VS Code']);
    options.push(['gemini', 'Gemini — open in VS Code']);
    if (installed.antigravity) options.push(['antigravity', 'Antigravity — open prompt']);
    return options;
  }

  function update() {
    for (const [container, task] of controls) {
      if (!container.isConnected) { controls.delete(container); continue; }
      const select = container.querySelector('select');
      const button = container.querySelector('button');
      if (!select || !button) continue;
      const options = optionsFor(task);
      select.replaceChildren(...options.map(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
      }));
      const preferred = task.route?.recommended_destination === 'codex' ? 'codex'
        : task.route?.recommended_destination === 'gemini_web' ? 'gemini' : 'chatgpt';
      const choice = selected.get(task.id);
      select.value = options.some(([value]) => value === choice) ? choice
        : options.some(([value]) => value === preferred) ? preferred : options[0][0];
      const busy = pending.has(task.id);
      select.disabled = busy;
      button.disabled = busy || !select.value;
      button.textContent = busy ? 'Working…' : select.value === 'codex' ? 'Run' : 'Open';
    }
  }

  function render(container, task) {
    controls.set(container, task);
    container.replaceChildren();
    const label = document.createElement('label');
    label.textContent = 'Destination';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Destination');
    select.addEventListener('change', () => {
      selected.set(task.id, select.value);
      const button = container.querySelector('button');
      if (button) button.textContent = select.value === 'codex' ? 'Run' : 'Open';
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-primary';
    button.addEventListener('click', () => {
      if (button.disabled || pending.has(task.id)) return;
      if (select.value === 'codex') {
        pending.add(task.id);
        update();
        vscode.postMessage({ type: 'runCodex', taskId: task.id });
      } else {
        vscode.postMessage({ type: 'planExternal', target: select.value, taskId: task.id });
      }
    });
    label.append(select);
    container.append(label, button);
    update();
  }

  window.addEventListener('message', ({ data }) => {
    if (data?.type === 'handoffAvailability') {
      installed = data.installed || {};
    } else if (data?.type === 'taskActionResult') {
      pending.delete(data.taskId);
    } else if (data?.type === 'history') {
      for (const task of data.tasks) {
        for (const [container, current] of controls) {
          if (current.id === task.id) controls.set(container, task);
        }
      }
    } else return;
    update();
  });
  return { render, update };
}
