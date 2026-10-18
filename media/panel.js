(() => {
  const vscode = acquireVsCodeApi();
  const form = document.getElementById('task-form');
  const task = document.getElementById('task');
  const result = document.getElementById('result');
  task.value = vscode.getState()?.task ?? '';

  task.addEventListener('input', () => vscode.setState({ task: task.value }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!task.value.trim()) return;
    vscode.postMessage({ type: 'routeTask', text: task.value });
  });
  window.addEventListener('message', ({ data }) => {
    if (data?.type === 'received' && typeof data.text === 'string') {
      result.textContent = data.text;
    }
  });
})();
