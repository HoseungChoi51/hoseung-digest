const state = {
  digests: [],
  current: null,
  showRaw: false
};

const elements = {
  statusText: document.querySelector('#statusText'),
  generateButton: document.querySelector('#generateButton'),
  digestList: document.querySelector('#digestList'),
  digestTitle: document.querySelector('#digestTitle'),
  digestMeta: document.querySelector('#digestMeta'),
  entries: document.querySelector('#entries'),
  emptyState: document.querySelector('#emptyState'),
  rawMarkdown: document.querySelector('#rawMarkdown'),
  toggleRawButton: document.querySelector('#toggleRawButton'),
  searchInput: document.querySelector('#searchInput'),
  subredditFilter: document.querySelector('#subredditFilter')
};

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function markdownListToHtml(lines) {
  const items = (lines || [])
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `<li>${escapeHtml(item)}</li>`);
  return items.length ? `<ul>${items.join('')}</ul>` : '<p>No notes yet.</p>';
}

function renderDigests() {
  elements.digestList.innerHTML = state.digests
    .map(
      (date) =>
        `<button class="digest-link ${state.current?.metadata?.date === date ? 'active' : ''}" data-date="${date}" type="button">${date}</button>`
    )
    .join('');
}

function updateSubredditFilter(entries) {
  const current = elements.subredditFilter.value;
  const subreddits = [...new Set(entries.map((entry) => entry.subreddit).filter(Boolean))].sort();
  elements.subredditFilter.innerHTML =
    '<option value="">All subreddits</option>' +
    subreddits.map((name) => `<option value="${escapeHtml(name)}">r/${escapeHtml(name)}</option>`).join('');
  elements.subredditFilter.value = subreddits.includes(current) ? current : '';
}

function renderEntry(entry) {
  const links = Object.entries(entry.links || {})
    .map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`)
    .join('');

  return `
    <article class="entry" data-subreddit="${escapeHtml(entry.subreddit)}" data-search="${escapeHtml(
      `${entry.title} ${entry.summary} ${entry.whyItMayMatter.join(' ')} ${entry.subreddit}`.toLowerCase()
    )}">
      <h3>${escapeHtml(entry.title)}</h3>
      <div class="entry-meta">
        <span class="pill">r/${escapeHtml(entry.subreddit)}</span>
      </div>
      <div class="section-title">Summary</div>
      <p>${escapeHtml(entry.summary.replace(/^_No summary generated\._$/, 'No summary generated.'))}</p>
      <div class="section-title">Why It May Matter</div>
      ${markdownListToHtml(entry.whyItMayMatter)}
      <div class="section-title">Links</div>
      <div class="links">${links}</div>
    </article>
  `;
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const subreddit = elements.subredditFilter.value;

  for (const entry of elements.entries.querySelectorAll('.entry')) {
    const matchesQuery = !query || entry.dataset.search.includes(query);
    const matchesSubreddit = !subreddit || entry.dataset.subreddit === subreddit;
    entry.hidden = !(matchesQuery && matchesSubreddit);
  }
}

function renderCurrentDigest() {
  const digest = state.current;
  const hasDigest = Boolean(digest);

  elements.emptyState.hidden = hasDigest;
  elements.entries.hidden = !hasDigest || state.showRaw;
  elements.rawMarkdown.hidden = !hasDigest || !state.showRaw;
  elements.toggleRawButton.disabled = !hasDigest;

  if (!digest) {
    elements.digestTitle.textContent = 'No digest selected';
    elements.digestMeta.textContent = '';
    elements.entries.innerHTML = '';
    elements.rawMarkdown.textContent = '';
    return;
  }

  elements.digestTitle.textContent = `Reddit Digest - ${digest.metadata.date}`;
  elements.digestMeta.textContent = `${digest.metadata.post_count || digest.entries.length} posts · summaries ${digest.metadata.summary_status || 'unknown'}`;
  elements.entries.innerHTML = digest.entries.map(renderEntry).join('');
  elements.rawMarkdown.textContent = digest.markdown;
  updateSubredditFilter(digest.entries);
  applyFilters();
}

async function loadStatus() {
  try {
    const status = await api('/api/status');
    const auth = status.reddit.authenticated ? 'Reddit connected' : 'Reddit not connected';
    const ai = status.openai.configured ? 'OpenAI summaries enabled' : 'OpenAI summaries skipped';
    elements.statusText.textContent = `${auth} · ${ai} · ${status.config.timezone}`;
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  }
}

async function loadDigestList(selectFirst = true) {
  const body = await api('/api/digests');
  state.digests = body.digests || [];
  renderDigests();
  if (selectFirst && state.digests.length) {
    await loadDigest(state.digests[0]);
  } else {
    renderCurrentDigest();
  }
}

async function loadDigest(date) {
  state.current = await api(`/api/digests/${date}`);
  renderDigests();
  renderCurrentDigest();
}

async function generateToday() {
  elements.generateButton.disabled = true;
  elements.generateButton.textContent = 'Generating...';
  try {
    const result = await api('/api/generate', { method: 'POST' });
    await loadDigestList(false);
    await loadDigest(result.date);
    await loadStatus();
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  } finally {
    elements.generateButton.disabled = false;
    elements.generateButton.textContent = 'Generate Today';
  }
}

elements.digestList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-date]');
  if (button) loadDigest(button.dataset.date);
});

elements.generateButton.addEventListener('click', generateToday);
elements.toggleRawButton.addEventListener('click', () => {
  state.showRaw = !state.showRaw;
  elements.toggleRawButton.textContent = state.showRaw ? 'Rendered View' : 'Raw Markdown';
  renderCurrentDigest();
});
elements.searchInput.addEventListener('input', applyFilters);
elements.subredditFilter.addEventListener('change', applyFilters);

await loadStatus();
await loadDigestList();
