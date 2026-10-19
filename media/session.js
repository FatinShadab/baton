(() => {
  const vscode = acquireVsCodeApi();
  const listEl = document.getElementById('session-list');
  const emptyStateEl = document.getElementById('empty-state');
  const newSessionBtn = document.getElementById('new-session-btn');
  const searchInput = document.getElementById('session-search');
  const projectBar = document.getElementById('project-bar');
  const projectNameEl = document.getElementById('project-name');
  const noProjectBanner = document.getElementById('no-project-banner');
  const openProjectBtn = document.getElementById('open-project-btn');
  const tasksContainer = document.getElementById('tasks-container');

  let currentSessions = [];
  let currentActiveId = undefined;
  let currentProject = undefined;

  function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderSessions() {
    if (!currentProject) {
      if (noProjectBanner) noProjectBanner.hidden = false;
      if (projectBar) projectBar.hidden = true;
      if (tasksContainer) tasksContainer.hidden = true;
      return;
    }

    if (noProjectBanner) noProjectBanner.hidden = true;
    if (projectBar) {
      projectBar.hidden = false;
      if (projectNameEl) projectNameEl.textContent = currentProject.name;
    }
    if (tasksContainer) tasksContainer.hidden = false;

    const query = (searchInput.value || '').trim().toLowerCase();
    const filtered = currentSessions.filter((s) => {
      if (!query) return true;
      return (s.title && s.title.toLowerCase().includes(query));
    });

    listEl.querySelectorAll('.session-card').forEach((el) => el.remove());

    if (filtered.length === 0) {
      if (emptyStateEl) emptyStateEl.style.display = 'block';
      return;
    }

    if (emptyStateEl) emptyStateEl.style.display = 'none';

    filtered.forEach((session) => {
      const card = document.createElement('div');
      card.className = `session-card ${session.id === currentActiveId ? 'active' : ''}`;
      card.setAttribute('role', 'listitem');
      card.dataset.id = session.id;

      const header = document.createElement('div');
      header.className = 'session-card-header';

      const title = document.createElement('span');
      title.className = 'session-card-title';
      title.textContent = session.title || 'Untitled Task';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'session-card-delete';
      deleteBtn.title = 'Delete task';
      deleteBtn.innerHTML = '&#128465;'; // trash can icon
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ type: 'deleteSession', sessionId: session.id });
      });

      header.append(title, deleteBtn);

      const meta = document.createElement('div');
      meta.className = 'session-card-meta';

      const time = document.createElement('span');
      time.className = 'session-time';
      time.textContent = formatTime(session.updatedAt || session.createdAt);

      meta.append(time);

      const turnCount = session.turns?.filter((t) => t.role === 'user')?.length || session.taskIds?.length || 0;
      if (turnCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'session-badge';
        badge.textContent = `${turnCount} prompt${turnCount > 1 ? 's' : ''}`;
        meta.append(badge);
      }

      card.append(header, meta);

      card.addEventListener('click', () => {
        vscode.postMessage({ type: 'selectSession', sessionId: session.id });
      });

      listEl.appendChild(card);
    });
  }

  newSessionBtn?.addEventListener('click', () => {
    if (!currentProject) {
      vscode.postMessage({ type: 'openProject' });
      return;
    }
    vscode.postMessage({ type: 'newSession' });
  });

  openProjectBtn?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openProject' });
  });

  searchInput?.addEventListener('input', () => {
    renderSessions();
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'sessionsList') {
      currentSessions = message.sessions || [];
      currentProject = message.project;
      if (message.activeSessionId !== undefined) {
        currentActiveId = message.activeSessionId;
      }
      renderSessions();
    } else if (message.type === 'activeSessionChanged') {
      currentActiveId = message.activeSessionId;
      renderSessions();
    }
  });

  vscode.postMessage({ type: 'loadSessions' });
})();
