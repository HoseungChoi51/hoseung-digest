const state = {
  digests: [],
  current: null,
  showRaw: false
};

const elements = {
  statusText: document.querySelector('#statusText'),
  pollButton: document.querySelector('#pollButton'),
  generateButton: document.querySelector('#generateButton'),
  digestList: document.querySelector('#digestList'),
  digestTitle: document.querySelector('#digestTitle'),
  digestMeta: document.querySelector('#digestMeta'),
  entries: document.querySelector('#entries'),
  emptyState: document.querySelector('#emptyState'),
  rawMarkdown: document.querySelector('#rawMarkdown'),
  toggleRawButton: document.querySelector('#toggleRawButton'),
  searchInput: document.querySelector('#searchInput'),
  sourceFilter: document.querySelector('#sourceFilter'),
  tabFilter: document.querySelector('#tabFilter'),
  tabNav: document.querySelector('.tab-nav')
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

function updateSourceFilter(entries) {
  const current = elements.sourceFilter.value;
  const sources = [...new Set(entries.map((entry) => entry.source).filter(Boolean))].sort();
  elements.sourceFilter.innerHTML =
    '<option value="">All sources</option>' +
    sources.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  elements.sourceFilter.value = sources.includes(current) ? current : '';
}

function updateTabFilter(entries) {
  const current = elements.tabFilter.value;
  const tabs = [...new Set(entries.map((entry) => entry.tab).filter(Boolean))].sort();
  elements.tabFilter.innerHTML =
    '<option value="">All tabs</option>' +
    tabs.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  elements.tabFilter.value = tabs.includes(current) ? current : '';
}

function renderEntry(entry) {
  const links = Object.entries(entry.links || {})
    .map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`)
    .join('');

  return `
    <article class="entry" data-id="${escapeHtml(entry.id)}" data-source="${escapeHtml(entry.source)}" data-tab="${escapeHtml(entry.tab)}" data-search="${escapeHtml(
      `${entry.title} ${entry.summary} ${entry.whyItMayMatter.join(' ')} ${entry.entities.join(' ')} ${entry.source} ${entry.tab}`.toLowerCase()
    )}">
      <h3>${escapeHtml(entry.title)}</h3>
      <div class="entry-meta">
        <span class="pill">${escapeHtml(entry.source || 'Unknown source')}</span>
        <span class="pill">${escapeHtml(entry.tab || 'dev')}</span>
        <span class="pill">${escapeHtml(entry.section || '')}</span>
      </div>
      <div class="section-title">Summary</div>
      <p>${escapeHtml(entry.summary.replace(/^_No summary generated\._$/, 'No summary generated.'))}</p>
      <div class="section-title">Why It Matters</div>
      ${markdownListToHtml(entry.whyItMayMatter)}
      <div class="section-title">Links</div>
      <div class="links">${links}</div>
      <div class="entry-actions">
        <button class="secondary small" data-action="save" data-id="${escapeHtml(entry.id)}" type="button">Save</button>
        <button class="secondary small" data-action="hide" data-id="${escapeHtml(entry.id)}" type="button">Hide</button>
      </div>
    </article>
  `;
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const source = elements.sourceFilter.value;
  const tab = elements.tabFilter.value;

  for (const entry of elements.entries.querySelectorAll('.entry')) {
    const matchesQuery = !query || entry.dataset.search.includes(query);
    const matchesSource = !source || entry.dataset.source === source;
    const matchesTab = !tab || entry.dataset.tab === tab;
    entry.hidden = !(matchesQuery && matchesSource && matchesTab);
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

  elements.digestTitle.textContent = `Daily Tech Digest - ${digest.metadata.date}`;
  elements.digestMeta.textContent = `${digest.metadata.post_count || digest.entries.length} items · summaries ${digest.metadata.summary_status || 'unknown'}`;
  elements.entries.innerHTML = digest.entries.map(renderEntry).join('');
  elements.rawMarkdown.textContent = digest.markdown;
  updateSourceFilter(digest.entries);
  updateTabFilter(digest.entries);
  applyFilters();
}

async function loadStatus() {
  try {
    const status = await api('/api/status');
    const source = `${status.sources.configured} sources`;
    const stored = `${status.itemStore.totalItems} stored items`;
    const health = `${status.itemStore.errorSources} source errors`;
    const ai = status.openai.configured ? 'OpenAI summaries enabled' : 'OpenAI summaries skipped';
    elements.statusText.textContent = `${source} · ${stored} · ${health} · ${ai} · ${status.config.timezone}`;
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

async function pollNow() {
  elements.pollButton.disabled = true;
  elements.pollButton.textContent = 'Polling...';
  try {
    await api('/api/poll', { method: 'POST' });
    await loadStatus();
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  } finally {
    elements.pollButton.disabled = false;
    elements.pollButton.textContent = 'Poll RSS';
  }
}

elements.digestList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-date]');
  if (button) loadDigest(button.dataset.date);
});

elements.pollButton.addEventListener('click', pollNow);
elements.generateButton.addEventListener('click', generateToday);
elements.entries.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action][data-id]');
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/items/${encodeURIComponent(button.dataset.id)}/${button.dataset.action}`, { method: 'POST' });
    if (button.dataset.action === 'hide') {
      button.closest('.entry').hidden = true;
    }
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  } finally {
    button.disabled = false;
  }
});
elements.toggleRawButton.addEventListener('click', () => {
  state.showRaw = !state.showRaw;
  elements.toggleRawButton.textContent = state.showRaw ? 'Rendered View' : 'Raw Markdown';
  renderCurrentDigest();
});
elements.searchInput.addEventListener('input', applyFilters);
elements.sourceFilter.addEventListener('change', applyFilters);
elements.tabFilter.addEventListener('change', applyFilters);
elements.tabNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  elements.tabFilter.value = button.dataset.tab;
  for (const item of elements.tabNav.querySelectorAll('.tab-button')) {
    item.classList.toggle('active', item === button);
  }
  applyFilters();
});

await loadStatus();
await loadDigestList();
