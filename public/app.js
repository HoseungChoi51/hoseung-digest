const state = {
  digests: [],
  current: null,
  preferences: {},
  showRaw: false,
  mode: 'digest',
  library: {
    items: [],
    total: 0,
    nextOffset: 0,
    limit: 100,
    sources: [],
    tabs: []
  }
};

const elements = {
  statusText: document.querySelector('#statusText'),
  pollButton: document.querySelector('#pollButton'),
  generateButton: document.querySelector('#generateButton'),
  refreshSummariesButton: document.querySelector('#refreshSummariesButton'),
  stopServerButton: document.querySelector('#stopServerButton'),
  digestViewButton: document.querySelector('#digestViewButton'),
  libraryViewButton: document.querySelector('#libraryViewButton'),
  libraryControls: document.querySelector('#libraryControls'),
  libraryScope: document.querySelector('#libraryScope'),
  digestList: document.querySelector('#digestList'),
  digestTitle: document.querySelector('#digestTitle'),
  digestMeta: document.querySelector('#digestMeta'),
  entries: document.querySelector('#entries'),
  emptyState: document.querySelector('#emptyState'),
  rawMarkdown: document.querySelector('#rawMarkdown'),
  toggleRawButton: document.querySelector('#toggleRawButton'),
  loadMoreButton: document.querySelector('#loadMoreButton'),
  searchInput: document.querySelector('#searchInput'),
  sourceFilter: document.querySelector('#sourceFilter'),
  tabFilter: document.querySelector('#tabFilter'),
  tabNav: document.querySelector('.tab-nav')
};

let librarySearchTimer = null;

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

function list(value) {
  return Array.isArray(value) ? value : [];
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function markdownListToHtml(lines) {
  const items = list(lines)
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) => `<li>${escapeHtml(item.replace(/^- /, ''))}</li>`);
  return items.length ? `<ul>${items.join('')}</ul>` : '<p>No notes yet.</p>';
}

function activeEntries() {
  return state.mode === 'library' ? state.library.items : state.current?.entries || [];
}

function activeEntryById(id) {
  return activeEntries().find((entry) => entry.id === id);
}

function preferenceFor(entry) {
  return state.preferences?.[entry.id] || entry.preference || null;
}

function preferenceButton(entry, label, score, text) {
  const preference = preferenceFor(entry);
  const active = preference?.label === label;
  return `<button class="secondary small preference-button ${active ? 'active' : ''}" aria-pressed="${active}" data-preference="${escapeHtml(
    label
  )}" data-score="${score}" data-id="${escapeHtml(entry.id)}" type="button">${escapeHtml(text)}</button>`;
}

function preferenceSummary(entry) {
  const preference = preferenceFor(entry);
  if (!preference || preference.label === 'neutral') return '';
  const labels = {
    must_read: 'Must read',
    useful: 'Useful',
    not_for_me: 'Not for me'
  };
  return `<span class="preference-state">${escapeHtml(labels[preference.label] || preference.label)}</span>`;
}

function currentLibraryLoadedLimit() {
  return Math.max(state.library.limit, state.library.nextOffset, state.library.items.length);
}

function entryMatchesLibraryScope(entry) {
  const scope = elements.libraryScope.value;
  const preference = preferenceFor(entry);
  if (scope === 'saved') return Boolean(entry.saved);
  if (scope === 'hidden') return Boolean(entry.hidden);
  if (scope === 'preferred') return ['must_read', 'useful'].includes(preference?.label);
  return true;
}

function renderLibraryAfterMutation() {
  if (state.mode !== 'library') {
    renderCurrentDigest();
    return;
  }

  const before = state.library.items.length;
  state.library.items = state.library.items.filter(entryMatchesLibraryScope);
  const removed = before - state.library.items.length;
  if (removed > 0) {
    state.library.total = Math.max(state.library.items.length, state.library.total - removed);
    state.library.nextOffset = Math.max(state.library.items.length, state.library.nextOffset - removed);
  }
  renderLibrary();
}

function entrySearchText(entry) {
  return [
    entry.title,
    entry.summary,
    ...list(entry.whyItMayMatter),
    ...list(entry.entities),
    ...list(entry.tags),
    entry.source,
    entry.tab,
    entry.domain,
    entry.section
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function textHash(value) {
  let hash = 0;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function sourceKind(source) {
  const normalized = String(source || '').toLowerCase();
  if (normalized.startsWith('r/')) return 'reddit';
  if (normalized.includes('hacker news')) return 'hackernews';
  return 'feed';
}

function sourceInitials(source) {
  const kind = sourceKind(source);
  if (kind === 'reddit') return 'r/';
  if (kind === 'hackernews') return 'HN';

  const words = String(source || 'Source')
    .replace(/^the\s+/i, '')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  const initials = words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return initials || 'S';
}

function sourceSticker(entry) {
  const source = entry.source || 'Unknown source';
  const kind = sourceKind(source);
  const tone = textHash(source) % 10;
  return `<span class="source-sticker source-kind-${kind} source-tone-${tone}" title="${escapeHtml(source)}"><span class="source-mark">${escapeHtml(
    sourceInitials(source)
  )}</span><span class="source-name">${escapeHtml(source)}</span></span>`;
}

function entryBadges(entry) {
  const badges = [
    entry.tab || 'dev',
    entry.section || entry.domain || '',
    entry.saved ? 'Saved' : '',
    entry.hidden ? 'Hidden' : ''
  ].filter(Boolean);

  return [sourceSticker(entry), ...badges.map((badge) => `<span class="pill">${escapeHtml(badge)}</span>`)].join('');
}

function entryLinks(entry) {
  const links = Object.entries(entry.links || {})
    .filter(([, url]) => url)
    .map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`)
    .join('');
  return links || '<span class="muted">No link stored.</span>';
}

function renderEntry(entry) {
  const summary = String(entry.summary || '').replace(/^_No summary generated\._$/, 'No summary generated.');
  const saveAction = entry.saved ? 'unsave' : 'save';
  const hideAction = entry.hidden ? 'unhide' : 'hide';
  const dateLabel = formatDate(entry.publishedAt || entry.firstSeenAt || entry.fetchedAt);

  return `
    <article class="entry" data-id="${escapeHtml(entry.id)}" data-source="${escapeHtml(entry.source)}" data-tab="${escapeHtml(entry.tab)}" data-search="${escapeHtml(
      entrySearchText(entry)
    )}">
      <div class="entry-heading">
        <h3>${escapeHtml(entry.title)}</h3>
        ${dateLabel ? `<span class="entry-date">${escapeHtml(dateLabel)}</span>` : ''}
      </div>
      <div class="entry-meta">${entryBadges(entry)}</div>
      <div class="section-title">Summary</div>
      <p>${escapeHtml(summary || 'No summary generated.')}</p>
      ${
        list(entry.whyItMayMatter).filter(Boolean).length
          ? `<div class="section-title">Why It Matters</div>${markdownListToHtml(entry.whyItMayMatter)}`
          : ''
      }
      <div class="section-title">Links</div>
      <div class="links">${entryLinks(entry)}</div>
      <div class="section-title">Preference</div>
      <div class="preference-actions">
        ${preferenceButton(entry, 'must_read', 2, 'Must read')}
        ${preferenceButton(entry, 'useful', 1, 'Useful')}
        ${preferenceButton(entry, 'not_for_me', -1, 'Not for me')}
        ${preferenceButton(entry, 'neutral', 0, 'Clear')}
        ${preferenceSummary(entry)}
      </div>
      <div class="entry-actions">
        <button class="secondary small" data-action="${saveAction}" data-id="${escapeHtml(entry.id)}" type="button">${entry.saved ? 'Unsave' : 'Save'}</button>
        <button class="secondary small" data-action="${hideAction}" data-id="${escapeHtml(entry.id)}" type="button">${entry.hidden ? 'Unhide' : 'Hide'}</button>
      </div>
    </article>
  `;
}

function renderDigests() {
  elements.digestList.innerHTML = state.digests
    .map(
      (date) =>
        `<button class="digest-link ${state.current?.metadata?.date === date ? 'active' : ''}" data-date="${date}" type="button">${date}</button>`
    )
    .join('');
}

function updateSelectOptions(select, values, emptyLabel) {
  const current = select.value;
  const sorted = [...new Set(values.filter(Boolean))].sort();
  select.innerHTML =
    `<option value="">${escapeHtml(emptyLabel)}</option>` +
    sorted.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  select.value = sorted.includes(current) ? current : '';
}

function updateTabButtons() {
  for (const item of elements.tabNav.querySelectorAll('.tab-button')) {
    item.classList.toggle('active', item.dataset.tab === elements.tabFilter.value);
  }
}

function updateFiltersForDigest(entries) {
  updateSelectOptions(elements.sourceFilter, entries.map((entry) => entry.source), 'All sources');
  updateSelectOptions(elements.tabFilter, entries.map((entry) => entry.tab), 'All tabs');
  updateTabButtons();
}

function updateFiltersForLibrary() {
  updateSelectOptions(elements.sourceFilter, state.library.sources, 'All sources');
  updateSelectOptions(elements.tabFilter, state.library.tabs, 'All tabs');
  updateTabButtons();
}

function applyDigestFilters() {
  if (state.mode !== 'digest') return;
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

function syncModeChrome() {
  const isLibrary = state.mode === 'library';
  elements.digestViewButton.classList.toggle('active', !isLibrary);
  elements.libraryViewButton.classList.toggle('active', isLibrary);
  elements.libraryControls.hidden = !isLibrary;
  elements.digestList.hidden = isLibrary;
  elements.toggleRawButton.hidden = isLibrary;
  elements.loadMoreButton.hidden = true;
  elements.searchInput.placeholder = isLibrary ? 'Search article DB' : 'Search local digests';
}

function renderCurrentDigest() {
  const digest = state.current;
  const hasDigest = Boolean(digest);
  const visibleEntries = digest?.entries?.filter((entry) => !entry.hidden) || [];

  syncModeChrome();
  elements.emptyState.hidden = hasDigest;
  elements.entries.hidden = !hasDigest || state.showRaw;
  elements.rawMarkdown.hidden = !hasDigest || !state.showRaw;
  elements.toggleRawButton.disabled = !hasDigest;
  elements.loadMoreButton.hidden = true;

  if (!digest) {
    elements.digestTitle.textContent = 'No digest selected';
    elements.digestMeta.textContent = '';
    elements.emptyState.textContent = 'Generate a digest or select one from the left.';
    elements.entries.innerHTML = '';
    elements.rawMarkdown.textContent = '';
    updateFiltersForDigest([]);
    return;
  }

  elements.digestTitle.textContent = `Daily Tech Digest - ${digest.metadata.date}`;
  elements.digestMeta.textContent = `${digest.metadata.post_count || digest.entries.length} items · summaries ${digest.metadata.summary_status || 'unknown'}`;
  elements.entries.innerHTML = visibleEntries.map(renderEntry).join('');
  elements.rawMarkdown.textContent = digest.markdown;
  updateFiltersForDigest(visibleEntries);
  applyDigestFilters();
}

function renderLibrary() {
  syncModeChrome();
  updateFiltersForLibrary();

  const shown = state.library.items.length;
  const total = state.library.total;
  elements.emptyState.hidden = shown > 0;
  elements.entries.hidden = false;
  elements.rawMarkdown.hidden = true;
  elements.toggleRawButton.disabled = true;
  elements.digestTitle.textContent = 'Article Library';
  elements.digestMeta.textContent = `${shown} shown · ${total} matching · ${elements.libraryScope.options[elements.libraryScope.selectedIndex].text}`;
  elements.emptyState.textContent = 'No stored items match these filters.';
  elements.entries.innerHTML = state.library.items.map(renderEntry).join('');
  elements.loadMoreButton.hidden = state.library.nextOffset >= total;
}

async function loadStatus() {
  try {
    const status = await api('/api/status');
    const source = `${status.sources.configured} sources`;
    const stored = `${status.itemStore.totalItems} stored items`;
    const preferences = `${status.preferences?.total || 0} preferences`;
    const health = `${status.itemStore.errorSources} source errors`;
    const ai = status.openai.configured ? 'OpenAI summaries enabled' : 'OpenAI summaries skipped';
    elements.statusText.textContent = `${source} · ${stored} · ${preferences} · ${health} · ${ai} · ${status.config.timezone}`;
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  }
}

async function loadPreferences() {
  const body = await api('/api/preferences');
  state.preferences = body.preferences || {};
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
  await loadPreferences();
  state.current = await api(`/api/digests/${date}`);
  state.mode = 'digest';
  renderDigests();
  renderCurrentDigest();
}

async function loadLibrary(offset = 0, append = false, limit = state.library.limit) {
  const params = new URLSearchParams({
    view: elements.libraryScope.value,
    limit: String(limit),
    offset: String(offset)
  });
  if (elements.searchInput.value.trim()) params.set('q', elements.searchInput.value.trim());
  if (elements.sourceFilter.value) params.set('source', elements.sourceFilter.value);
  if (elements.tabFilter.value) params.set('tab', elements.tabFilter.value);

  const body = await api(`/api/items?${params.toString()}`);
  for (const item of body.items || []) {
    if (item.preference) state.preferences[item.id] = item.preference;
  }

  state.library = {
    ...state.library,
    items: append ? [...state.library.items, ...(body.items || [])] : body.items || [],
    total: body.total || 0,
    nextOffset: Number(body.offset || 0) + (body.items || []).length,
    sources: body.sources || [],
    tabs: body.tabs || []
  };
  renderLibrary();
}

async function reloadLoadedLibrary() {
  const loadedCount = currentLibraryLoadedLimit();
  await loadLibrary(0, false, loadedCount);
}

function scheduleLibraryLoad() {
  clearTimeout(librarySearchTimer);
  librarySearchTimer = setTimeout(() => {
    loadLibrary().catch((error) => {
      elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    });
  }, 180);
}

async function showMode(mode) {
  state.mode = mode;
  if (mode === 'library') {
    await loadLibrary();
  } else {
    renderCurrentDigest();
  }
}

async function generateToday(refreshSummaries = false) {
  elements.generateButton.disabled = true;
  elements.refreshSummariesButton.disabled = true;
  const button = refreshSummaries ? elements.refreshSummariesButton : elements.generateButton;
  button.textContent = refreshSummaries ? 'Refreshing...' : 'Generating...';
  try {
    const result = await api(`/api/generate${refreshSummaries ? '?refreshSummaries=1' : ''}`, { method: 'POST' });
    await loadDigestList(false);
    await loadDigest(result.date);
    await loadStatus();
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  } finally {
    elements.generateButton.disabled = false;
    elements.refreshSummariesButton.disabled = false;
    elements.generateButton.textContent = 'Generate Today';
    elements.refreshSummariesButton.textContent = 'Refresh Summaries';
  }
}

async function pollNow() {
  elements.pollButton.disabled = true;
  elements.pollButton.textContent = 'Polling...';
  try {
    await api('/api/poll', { method: 'POST' });
    await loadStatus();
    if (state.mode === 'library') await reloadLoadedLibrary();
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  } finally {
    elements.pollButton.disabled = false;
    elements.pollButton.textContent = 'Poll RSS';
  }
}

async function stopServer() {
  const confirmed = window.confirm('Stop the local digest server?');
  if (!confirmed) return;

  elements.stopServerButton.disabled = true;
  elements.stopServerButton.textContent = 'Stopping...';
  try {
    await api('/api/shutdown', { method: 'POST' });
    elements.statusText.textContent = 'Server stopped. Restart it from the terminal with npm run dev.';
    elements.pollButton.disabled = true;
    elements.generateButton.disabled = true;
    elements.refreshSummariesButton.disabled = true;
    elements.stopServerButton.textContent = 'Stopped';
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
    elements.stopServerButton.disabled = false;
    elements.stopServerButton.textContent = 'Stop Server';
  }
}

function updateActiveEntry(item) {
  const entry = activeEntryById(item.id);
  if (!entry) return;
  entry.saved = Boolean(item.saved);
  entry.hidden = Boolean(item.hidden);
}

async function setPreference(button) {
  const entry = activeEntryById(button.dataset.id);
  if (!entry) return;
  button.disabled = true;
  try {
    if (button.dataset.preference === 'neutral') {
      await api(`/api/preferences/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
      delete state.preferences[entry.id];
      delete entry.preference;
    } else {
      const body = await api(`/api/preferences/${encodeURIComponent(entry.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: button.dataset.preference,
          score: Number(button.dataset.score),
          entry
        })
      });
      state.preferences[entry.id] = body.preference;
      entry.preference = body.preference;
      if (body.item) updateActiveEntry(body.item);
    }
    await loadStatus();
    renderLibraryAfterMutation();
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  } finally {
    button.disabled = false;
  }
}

async function setItemAction(button) {
  button.disabled = true;
  try {
    const body = await api(`/api/items/${encodeURIComponent(button.dataset.id)}/${button.dataset.action}`, { method: 'POST' });
    updateActiveEntry(body.item);
    await loadStatus();
    renderLibraryAfterMutation();
  } catch (error) {
    elements.statusText.innerHTML = `<span class="error">${escapeHtml(error.message)}</span>`;
  } finally {
    button.disabled = false;
  }
}

elements.digestList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-date]');
  if (button) loadDigest(button.dataset.date);
});

elements.digestViewButton.addEventListener('click', () => showMode('digest'));
elements.libraryViewButton.addEventListener('click', () => showMode('library'));
elements.libraryScope.addEventListener('change', () => loadLibrary());
elements.loadMoreButton.addEventListener('click', () => loadLibrary(state.library.nextOffset, true));
elements.pollButton.addEventListener('click', pollNow);
elements.generateButton.addEventListener('click', () => generateToday(false));
elements.refreshSummariesButton.addEventListener('click', () => generateToday(true));
elements.stopServerButton.addEventListener('click', stopServer);
elements.entries.addEventListener('click', async (event) => {
  const preference = event.target.closest('[data-preference][data-id]');
  if (preference) {
    await setPreference(preference);
    return;
  }

  const action = event.target.closest('[data-action][data-id]');
  if (action) await setItemAction(action);
});
elements.toggleRawButton.addEventListener('click', () => {
  state.showRaw = !state.showRaw;
  elements.toggleRawButton.textContent = state.showRaw ? 'Rendered View' : 'Raw Markdown';
  renderCurrentDigest();
});
elements.searchInput.addEventListener('input', () => {
  if (state.mode === 'library') {
    scheduleLibraryLoad();
  } else {
    applyDigestFilters();
  }
});
elements.sourceFilter.addEventListener('change', () => {
  if (state.mode === 'library') {
    loadLibrary();
  } else {
    applyDigestFilters();
  }
});
elements.tabFilter.addEventListener('change', () => {
  updateTabButtons();
  if (state.mode === 'library') {
    loadLibrary();
  } else {
    applyDigestFilters();
  }
});
elements.tabNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  elements.tabFilter.value = button.dataset.tab;
  updateTabButtons();
  if (state.mode === 'library') {
    loadLibrary();
  } else {
    applyDigestFilters();
  }
});

await loadPreferences();
await loadStatus();
await loadDigestList();
