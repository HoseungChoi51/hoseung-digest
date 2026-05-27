import { enrichRedditItem, fetchSource } from './adapters.js';
import { readItemStore, updateSourceHealth, upsertItems } from './item-store.js';

export async function pollSources(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date().toISOString();
  let store = options.store || (await readItemStore(options.storePath));
  const sources = (options.sources || config.sources || []).filter((source) => source.enabled !== false);
  const fetched = [];
  const errors = [];
  const notModified = [];

  if (!sources.length) {
    throw new Error('No sources configured. Add source records to config/sources.yml or subreddits.include.');
  }

  for (const source of sources) {
    try {
      const result = await fetchSource(source, config, {
        fetchImpl,
        now,
        sourceState: store.sources[source.id] || {}
      });

      if (result.notModified) {
        notModified.push(source.id);
      }

      fetched.push(...result.items);
      store = await updateSourceHealth(
        source,
        {
          etag: result.etag || store.sources[source.id]?.etag || '',
          last_modified: result.lastModified || store.sources[source.id]?.last_modified || '',
          last_fetched_at: now,
          last_success_at: now,
          last_error: ''
        },
        { store, storePath: options.storePath }
      );
    } catch (error) {
      errors.push({ source_id: source.id, source: source.name, error: error.message });
      store = await updateSourceHealth(
        source,
        {
          last_fetched_at: now,
          last_error: error.message
        },
        { store, storePath: options.storePath }
      );
    }
  }

  const firstPass = await upsertItems(fetched, { store, storePath: options.storePath, now });
  store = firstPass.store;

  const itemsToEnrich = config.enrichment.enabled
    ? firstPass.newItems
        .filter((item) => item.adapter === 'reddit_rss')
        .slice(0, config.enrichment.max_new_posts)
    : [];

  const enriched = [];
  for (const item of itemsToEnrich) {
    try {
      const metadata = await enrichRedditItem(item, config, fetchImpl);
      if (metadata) enriched.push(metadata);
    } catch (error) {
      enriched.push({
        ...item,
        enrichment_error: error.message,
        enriched_at: new Date().toISOString()
      });
    }
  }

  const finalPass = enriched.length
    ? await upsertItems(enriched, { store, storePath: options.storePath, now })
    : firstPass;

  return {
    store: finalPass.store,
    sources,
    fetched: fetched.length,
    inserted: firstPass.inserted,
    updated: firstPass.updated,
    enriched: enriched.filter((post) => !post.enrichment_error).length,
    enrichmentErrors: enriched.filter((post) => post.enrichment_error).length,
    notModified,
    errors
  };
}

export async function pollSubreddits(config, options = {}) {
  const redditSources = (config.sources || []).filter((source) => source.adapter === 'reddit_rss');
  return pollSources(config, { ...options, sources: redditSources });
}
