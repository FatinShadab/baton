// Baton — Resources and Media Stream UI Controller
function initializeResources(vscode) {
  const tierBadge = document.getElementById('research-tier-badge');
  const statusText = document.getElementById('research-status');
  const loadingEl = document.getElementById('research-loading');
  const ytGroup = document.getElementById('yt-group');
  const ytList = document.getElementById('yt-cards-list');
  const blogGroup = document.getElementById('blog-group');
  const blogList = document.getElementById('blog-tiles-list');
  const artifactGroup = document.getElementById('artifact-group');
  const artifactList = document.getElementById('artifact-tiles-list');

  function openUrl(url) {
    if (!url) return;
    vscode.postMessage({ type: 'openExternalUrl', url });
  }

  function setSearching(query) {
    if (loadingEl) loadingEl.hidden = false;
    if (tierBadge) {
      tierBadge.textContent = 'Searching…';
      tierBadge.className = 'research-tier-badge';
    }
    if (statusText) {
      const q = query ? (query.length > 40 ? `${query.slice(0, 40)}…` : query) : 'task';
      statusText.textContent = `Discovering resources and media for "${q}"…`;
    }
    if (ytGroup) ytGroup.hidden = true;
    if (blogGroup) blogGroup.hidden = true;
    if (artifactGroup) artifactGroup.hidden = true;
  }

  function renderResources(data) {
    if (!data) return;
    if (loadingEl) loadingEl.hidden = true;

    if (tierBadge) {
      tierBadge.textContent = data.tier === 'intelligent' ? 'Gemma AI' : 'Keyword Search';
      tierBadge.className = `research-tier-badge badge-${data.tier || 'keyword'}`;
    }

    if (statusText) {
      statusText.textContent = data.notice || (data.tier === 'intelligent'
        ? 'Curated via Gemma 4 (Google AI Studio).'
        : 'Discovered via keyword & syntax search (YouTube, Dev.to, arXiv).');
    }

    // 1. YouTube Videos
    if (ytList && ytGroup) {
      ytList.replaceChildren();
      const videos = data.videos || [];
      if (videos.length > 0) {
        videos.forEach((video) => {
          const card = document.createElement('div');
          card.className = 'yt-card';
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.title = `Watch on YouTube: ${video.title}`;

          const thumbWrap = document.createElement('div');
          thumbWrap.className = 'yt-thumb-wrap';

          const img = document.createElement('img');
          img.className = 'yt-thumb-img';
          img.src = video.thumbnailUrl;
          img.alt = video.title;
          img.loading = 'lazy';
          img.onerror = () => {
            img.src = 'https://www.youtube.com/img/desktop/yt_1200.png';
          };

          const playOverlay = document.createElement('div');
          playOverlay.className = 'yt-play-overlay';
          playOverlay.textContent = '▶';

          thumbWrap.append(img, playOverlay);

          const infoWrap = document.createElement('div');
          infoWrap.className = 'yt-info-wrap';

          const titleEl = document.createElement('div');
          titleEl.className = 'yt-title';
          titleEl.textContent = video.title;

          const metaRow = document.createElement('div');
          metaRow.className = 'yt-meta-row';

          const channelEl = document.createElement('span');
          channelEl.className = 'yt-channel';
          channelEl.textContent = video.channel || 'YouTube';

          const viewsEl = document.createElement('span');
          viewsEl.className = 'yt-views';
          viewsEl.textContent = video.views || '';

          metaRow.append(channelEl, viewsEl);
          infoWrap.append(titleEl, metaRow);
          card.append(thumbWrap, infoWrap);

          card.addEventListener('click', () => openUrl(video.url));
          card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openUrl(video.url);
            }
          });

          ytList.appendChild(card);
        });
        ytGroup.hidden = false;
      } else {
        ytGroup.hidden = true;
      }
    }

    // 2. Blogs & Articles
    if (blogList && blogGroup) {
      blogList.replaceChildren();
      const blogs = data.blogs || [];
      if (blogs.length > 0) {
        blogs.forEach((blog) => {
          const tile = document.createElement('div');
          tile.className = 'resource-tile';
          tile.setAttribute('role', 'button');
          tile.setAttribute('tabindex', '0');
          tile.title = `Read: ${blog.title}`;

          const topRow = document.createElement('div');
          topRow.className = 'tile-top-row';

          const sourceBadge = document.createElement('span');
          sourceBadge.className = 'tile-source-badge';
          sourceBadge.textContent = blog.source || 'Article';

          const statEl = document.createElement('span');
          statEl.className = 'tile-stat';
          statEl.textContent = blog.readingTime || blog.reactions || '';

          topRow.append(sourceBadge, statEl);

          const titleEl = document.createElement('div');
          titleEl.className = 'tile-title';
          titleEl.textContent = blog.title;

          const snippetEl = document.createElement('div');
          snippetEl.className = 'tile-snippet';
          snippetEl.textContent = blog.snippet || '';

          const footerEl = document.createElement('div');
          footerEl.className = 'tile-footer';

          const footerHost = document.createElement('span');
          footerHost.textContent = blog.source || '';

          const linkIcon = document.createElement('span');
          linkIcon.className = 'tile-link-icon';
          linkIcon.textContent = '↗';

          footerEl.append(footerHost, linkIcon);
          tile.append(topRow, titleEl, snippetEl, footerEl);

          tile.addEventListener('click', () => openUrl(blog.url));
          tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openUrl(blog.url);
            }
          });

          blogList.appendChild(tile);
        });
        blogGroup.hidden = false;
      } else {
        blogGroup.hidden = true;
      }
    }

    // 3. Research Artifacts
    if (artifactList && artifactGroup) {
      artifactList.replaceChildren();
      const artifacts = data.artifacts || [];
      if (artifacts.length > 0) {
        artifacts.forEach((art) => {
          const tile = document.createElement('div');
          tile.className = 'resource-tile';
          tile.setAttribute('role', 'button');
          tile.setAttribute('tabindex', '0');
          tile.title = `View Research Artifact: ${art.title}`;

          const topRow = document.createElement('div');
          topRow.className = 'tile-top-row';

          const sourceBadge = document.createElement('span');
          sourceBadge.className = 'tile-source-badge';
          sourceBadge.textContent = art.source || 'Research';

          const statEl = document.createElement('span');
          statEl.className = 'tile-stat';
          statEl.textContent = art.year ? `Year ${art.year}` : '';

          topRow.append(sourceBadge, statEl);

          const titleEl = document.createElement('div');
          titleEl.className = 'tile-title';
          titleEl.textContent = art.title;

          const snippetEl = document.createElement('div');
          snippetEl.className = 'tile-snippet';
          snippetEl.textContent = art.summary || '';

          const footerEl = document.createElement('div');
          footerEl.className = 'tile-footer';

          const authorsEl = document.createElement('span');
          authorsEl.textContent = art.authors || art.source || '';

          const linkIcon = document.createElement('span');
          linkIcon.className = 'tile-link-icon';
          linkIcon.textContent = '↗';

          footerEl.append(authorsEl, linkIcon);
          tile.append(topRow, titleEl, snippetEl, footerEl);

          tile.addEventListener('click', () => openUrl(art.url));
          tile.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openUrl(art.url);
            }
          });

          artifactList.appendChild(tile);
        });
        artifactGroup.hidden = false;
      } else {
        artifactGroup.hidden = true;
      }
    }
  }

  return { setSearching, renderResources };
}
