// Shared controls keep the Task card and History on the same execution path.
function initializeTaskActions(vscode) {
  const pending = new Set();
  const records = new Map();
  const controls = new Map();
  const choices = [['runCodex', 'Run in Codex'], ['markDone', 'Mark done'],
    ['showDiff', 'Show diff'], ['runTests', 'Run tests']];

  function update() {
    for (const [container, id] of controls) {
      if (!container.isConnected) { controls.delete(container); continue; }
      const task = records.get(id);
      for (const button of container.querySelectorAll('button')) {
        const type = button.dataset.action;
        button.disabled = !task || pending.has(id) || task.saved === false
          || (type === 'runCodex' && (!['RUN', 'CONFIRM'].includes(task.decision)
            || task.route?.risk_tier === 'high' || ['running', 'done', 'blocked'].includes(task.status)))
          || (type === 'markDone' && task.status === 'blocked');
      }
    }
  }

  function render(container, task) {
    records.set(task.id, task);
    controls.set(container, task.id);
    container.replaceChildren();
    for (const [type, label] of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.action = type;
      button.addEventListener('click', () => {
        if (button.disabled || pending.has(task.id)) return;
        pending.add(task.id);
        update();
        vscode.postMessage({ type, taskId: task.id });
      });
      container.append(button);
    }
    update();
  }

  window.addEventListener('message', ({ data }) => {
    if (data?.type === 'taskActionResult') pending.delete(data.taskId);
    else if (data?.type === 'history') {
      for (const task of data.tasks) records.set(task.id, task);
    } else return;
    update();
  });
  return { render, update };
}
