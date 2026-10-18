(() => {
  const vscode = acquireVsCodeApi();
  const form = document.getElementById('task-form');
  const task = document.getElementById('task');
  const card = document.getElementById('route-card');
  task.value = vscode.getState()?.task ?? '';

  task.addEventListener('input', () => {
    vscode.setState({ task: task.value });
    card.hidden = true;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!task.value.trim()) return;
    vscode.postMessage({ type: 'routeTask', text: task.value });
  });
  window.addEventListener('message', ({ data }) => {
    if (data?.type !== 'routed' || !data.decision?.route) return;
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
    card.hidden = false;
  });
})();
