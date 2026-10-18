(() => {
  const vscode = acquireVsCodeApi();
  const form = document.getElementById('task-form');
  const task = document.getElementById('task');
  const card = document.getElementById('route-card');
  const submit = form.querySelector('button[type="submit"]');
  const status = document.getElementById('routing-status');
  const tiers = { gemma: 'via Gemma (AI Studio)', ollama: 'via Ollama', rules: 'via rules' };
  task.value = vscode.getState()?.task ?? '';

  task.addEventListener('input', () => {
    vscode.setState({ task: task.value });
    card.hidden = true;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!task.value.trim() || submit.disabled) return;
    submit.disabled = true;
    card.hidden = true;
    status.textContent = 'Routing task…';
    vscode.postMessage({ type: 'routeTask', text: task.value });
  });
  window.addEventListener('message', ({ data }) => {
    if (data?.type === 'routeError') {
      submit.disabled = false;
      status.textContent = 'Could not route this task. Please try again.';
      return;
    }
    if (data?.type !== 'routed' || !data.decision?.route) return;
    submit.disabled = false;
    status.textContent = data.saved ? '' : 'Route ready, but local memory could not be saved.';
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
