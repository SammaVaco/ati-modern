import { runAskQuery } from './ask-core.js';
import { runAskVectorCapabilityProbe } from './ask-vector.js';

(function () {
  const form = document.getElementById('ask-form');
  const input = document.getElementById('ask-query');
  const statusNode = document.getElementById('ask-status');
  const confidenceNode = document.getElementById('ask-confidence');
  const digestNode = document.getElementById('ask-digest');
  const evidenceNode = document.getElementById('ask-evidence');

  if (!form || !input || !statusNode || !confidenceNode || !digestNode || !evidenceNode) {
    return;
  }

  function normalizeBasePath(rawPath) {
    if (!rawPath || rawPath === '/') return '';
    const withLeadingSlash = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '');
    return withoutTrailingSlash === '/' ? '' : withoutTrailingSlash;
  }

  function inferSiteBasePath() {
    const pathname = String(window.location.pathname || '');
    const marker = '/search_canon_results.html';
    if (pathname === marker || pathname.endsWith(marker)) {
      return normalizeBasePath(pathname.slice(0, -marker.length));
    }
    return '';
  }

  const siteBasePath = inferSiteBasePath();

  function withBasePath(urlPath) {
    const normalized = String(urlPath || '/');
    const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return `${siteBasePath}${absolutePath}` || '/';
  }

  function resolveHref(href) {
    const value = String(href || '');
    if (!value) return value;
    if (value.startsWith('/') && !value.startsWith('//')) {
      return withBasePath(value);
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) || value.startsWith('//') || value.startsWith('#')) {
      return value;
    }
    return value;
  }

  function updateStatus(message) {
    statusNode.textContent = message;
  }

  function confidenceLabel(level) {
    if (level === 'high') return 'Confidence: high';
    if (level === 'medium') return 'Confidence: medium';
    if (level === 'low') return 'Confidence: low';
    return 'Confidence: insufficient';
  }

  function modeLabel(mode) {
    return mode === 'lexical+vector' ? 'lexical + vector rerank' : 'lexical';
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function highlightSnippet(text, rawQuery) {
    const queryTerms = String(rawQuery || '')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 6);

    if (!queryTerms.length) {
      return escapeHtml(text);
    }

    let highlighted = escapeHtml(text);
    for (const term of queryTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      highlighted = highlighted.replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
    }
    return highlighted;
  }

  function clearRendered() {
    digestNode.innerHTML = '';
    evidenceNode.innerHTML = '';
  }

  function renderDigest(result) {
    digestNode.innerHTML = '';
    confidenceNode.textContent = confidenceLabel(result.confidence);
    confidenceNode.dataset.confidence = result.confidence;

    for (const bullet of result.digestBullets) {
      const li = document.createElement('li');
      li.className = 'ask-digest-item';

      const textSpan = document.createElement('span');
      textSpan.className = 'ask-digest-text';
      textSpan.textContent = bullet.text;
      li.append(textSpan);

      const citations = document.createElement('span');
      citations.className = 'ask-citations';

      bullet.citations.forEach((citation, index) => {
        const link = document.createElement('a');
        link.className = 'ask-citation-link';
        link.href = resolveHref(citation.url);
        link.textContent = `[${index + 1}]`;
        link.title = citation.title || citation.url;
        citations.append(link);
      });

      li.append(' ', citations);
      digestNode.append(li);
    }
  }

  function renderEvidence(result, rawQuery) {
    evidenceNode.innerHTML = '';

    for (const evidence of result.evidence) {
      const item = document.createElement('li');
      item.className = 'ask-evidence-card';

      const titleLink = document.createElement('a');
      titleLink.className = 'ask-evidence-link';
      titleLink.href = resolveHref(evidence.url);
      titleLink.textContent = evidence.title || evidence.url;

      const meta = document.createElement('p');
      meta.className = 'ask-evidence-meta';
      meta.textContent = `${evidence.section || 'site'} | score ${Number(evidence.combinedScore || evidence.score || 0).toFixed(2)}`;

      const excerpt = document.createElement('p');
      excerpt.className = 'ask-evidence-excerpt';
      excerpt.innerHTML = highlightSnippet(evidence.text || '', rawQuery);

      item.append(titleLink, meta, excerpt);
      evidenceNode.append(item);
    }
  }

  async function loadState() {
    if (!window.MiniSearch) {
      throw new Error('MiniSearch is not available');
    }

    const [indexRes, passagesRes, aliasesRes] = await Promise.all([
      fetch(withBasePath('/_search/ask/passages.minisearch.json'), { cache: 'no-store' }),
      fetch(withBasePath('/_search/ask/passages.json'), { cache: 'no-store' }),
      fetch(withBasePath('/_search/ask/aliases.json'), { cache: 'no-store' })
    ]);

    if (!indexRes.ok || !passagesRes.ok || !aliasesRes.ok) {
      throw new Error('Ask index artifacts are unavailable');
    }

    const [indexJson, passages, aliases] = await Promise.all([
      indexRes.json(),
      passagesRes.json(),
      aliasesRes.json()
    ]);

    const miniSearch = window.MiniSearch.loadJSON(JSON.stringify(indexJson), {
      idField: 'id',
      fields: ['titleFolded', 'textFolded'],
      storeFields: ['id', 'url', 'title', 'section', 'charStart', 'charEnd']
    });

    const baseState = {
      miniSearch,
      passageById: new Map(passages.map((row) => [row.id, row])),
      aliases
    };

    const vectorProbe = runAskVectorCapabilityProbe({
      budgetMs: 26,
      iterations: 7,
      probeWork: () => {
        runAskQuery(baseState, 'buddha', {
          vectorSearchEnabled: true,
          topK: 10
        });
      }
    });

    return {
      ...baseState,
      vectorProbe
    };
  }

  const statePromise = loadState();

  async function executeAsk(query) {
    updateStatus('Analyzing...');
    clearRendered();
    try {
      const state = await statePromise;
      const result = runAskQuery(state, query, {
        vectorSearchEnabled: Boolean(state.vectorProbe?.enabled)
      });
      const mode = modeLabel(result.mode);

      if (result.confidence === 'insufficient') {
        updateStatus(`Insufficient evidence for a reliable summary. Try refining your question. (${mode})`);
      } else {
        updateStatus(
          `${result.evidence.length} evidence passage${result.evidence.length === 1 ? '' : 's'} in ${Math.round(result.stats.totalMs)} ms (${mode}).`
        );
      }

      renderDigest(result);
      renderEvidence(result, query);
    } catch (error) {
      clearRendered();
      confidenceNode.textContent = 'Confidence: unavailable';
      confidenceNode.removeAttribute('data-confidence');
      updateStatus(`Ask unavailable: ${error.message}`);
    }
  }

  function syncUrl(query) {
    const url = new URL(window.location.href);
    if (query) {
      url.searchParams.set('q', query);
    } else {
      url.searchParams.delete('q');
    }
    window.history.replaceState({}, '', url.toString());
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    syncUrl(query);
    executeAsk(query);
  });

  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get('q') || params.get('query') || '';

  if (initialQuery) {
    input.value = initialQuery;
    executeAsk(initialQuery);
  } else {
    updateStatus('Ask a doctrinal or practice question to see citation-grounded evidence.');
    confidenceNode.textContent = 'Confidence: unavailable';
  }
})();
