import { rerankSearchResults, runVectorCapabilityProbe } from './vector.js';

(function () {
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-query');
  const resultsNode = document.getElementById('search-results');
  const statusNode = document.getElementById('search-status');

  if (!form || !input || !resultsNode || !statusNode) {
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
    const marker = '/search_results.html';
    if (pathname === marker || pathname.endsWith(marker)) {
      return normalizeBasePath(pathname.slice(0, -marker.length));
    }
    return '';
  }

  const siteBasePath = inferSiteBasePath();

  function withBasePath(urlPath) {
    const normalizedPath = String(urlPath || '/').startsWith('/') ? String(urlPath || '/') : `/${String(urlPath || '/')}`;
    return `${siteBasePath}${normalizedPath}` || '/';
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

  const velthuisReplacements = [
    [/AA/g, 'Ā'], [/aa/g, 'ā'], [/II/g, 'Ī'], [/ii/g, 'ī'], [/UU/g, 'Ū'], [/uu/g, 'ū'],
    [/"N/g, 'Ṅ'], [/"n/g, 'ṅ'], [/\.M/g, 'Ṃ'], [/\.m/g, 'ṃ'], [/~N/g, 'Ñ'], [/~n/g, 'ñ'],
    [/\.T/g, 'Ṭ'], [/\.t/g, 'ṭ'], [/\.D/g, 'Ḍ'], [/\.d/g, 'ḍ'], [/\.N/g, 'Ṇ'], [/\.n/g, 'ṇ'],
    [/\.L/g, 'Ḷ'], [/\.l/g, 'ḷ']
  ];

  function velthuisToUnicode(text) {
    let value = String(text || '');
    for (const [pattern, replacement] of velthuisReplacements) {
      value = value.replace(pattern, replacement);
    }
    return value;
  }

  function normalizeForSearch(text) {
    const unicode = velthuisToUnicode(text);
    const noMarks = unicode
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.~"]/g, '')
      .replace(/aa/g, 'a')
      .replace(/ii/g, 'i')
      .replace(/uu/g, 'u');
    return noMarks.replace(/\s+/g, ' ').trim();
  }

  function highlightSnippet(text, query) {
    const queryTerms = String(query || '')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 5);

    if (!queryTerms.length) {
      return escapeHtml(text);
    }

    let highlighted = escapeHtml(text);
    for (const term of queryTerms) {
      const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      highlighted = highlighted.replace(new RegExp(`(${escapedTerm})`, 'ig'), '<mark>$1</mark>');
    }
    return highlighted;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updateStatus(message) {
    statusNode.textContent = message;
  }

  function renderResults(state, results, query) {
    resultsNode.innerHTML = '';
    const modeLabel = state.vectorProbe?.enabled ? 'lexical + vector rerank' : 'lexical';

    if (!results.length) {
      updateStatus(`No results for "${query}" (${modeLabel}).`);
      return;
    }

    updateStatus(`${results.length} result${results.length === 1 ? '' : 's'} for "${query}" (${modeLabel}).`);

    for (const result of results) {
      const li = document.createElement('li');
      li.className = 'search-result';

      const anchor = document.createElement('a');
      anchor.href = resolveHref(result.url);
      anchor.textContent = result.title || result.url;
      anchor.setAttribute('data-result-link', 'true');

      const meta = document.createElement('div');
      meta.className = 'search-meta';
      meta.textContent = `${result.section || 'site'} ${result.dateModified ? `| updated ${result.dateModified}` : ''}`.trim();

      const snippet = document.createElement('p');
      snippet.innerHTML = highlightSnippet(result.textSnippet || '', query);

      li.append(anchor, meta, snippet);
      resultsNode.appendChild(li);
    }
  }

  function wireKeyboardNavigation() {
    resultsNode.addEventListener('keydown', (event) => {
      const links = Array.from(resultsNode.querySelectorAll('a[data-result-link="true"]'));
      if (!links.length) return;
      const currentIndex = links.indexOf(document.activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = links[Math.min(links.length - 1, currentIndex + 1)];
        (next || links[0]).focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = links[Math.max(0, currentIndex - 1)];
        (prev || links[0]).focus();
      }
    });
  }

  async function loadState() {
    if (!window.MiniSearch) {
      throw new Error('MiniSearch is not available');
    }

    const [indexRes, docsRes, aliasesRes] = await Promise.all([
      fetch(withBasePath('/_search/index.json'), { cache: 'no-store' }),
      fetch(withBasePath('/_search/docs.json'), { cache: 'no-store' }),
      fetch(withBasePath('/_search/redirect-aliases.json'), { cache: 'no-store' })
    ]);

    const [indexJson, docs, aliases] = await Promise.all([
      indexRes.json(),
      docsRes.json(),
      aliasesRes.json()
    ]);

    const miniSearch = window.MiniSearch.loadJSON(JSON.stringify(indexJson), {
      idField: 'id',
      fields: ['titleFolded', 'textFolded'],
      storeFields: ['url', 'title', 'section', 'dateModified', 'textSnippet']
    });

    const docByUrl = new Map(docs.map((doc) => [doc.url, doc]));
    const probeQuery = normalizeForSearch('buddha');
    const probeCandidates = miniSearch.search(probeQuery, {
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'OR'
    })
      .slice(0, 20)
      .map((row) => {
        const resolvedUrl = aliases[row.url] || row.url;
        const doc = docByUrl.get(resolvedUrl) || docByUrl.get(row.url) || {};
        return {
          score: row.score,
          url: resolvedUrl,
          title: doc.title || row.title || resolvedUrl,
          textSnippet: doc.textSnippet || row.textSnippet || ''
        };
      });

    let vectorProbe = {
      enabled: false,
      reason: 'insufficient-probe-sample',
      p95Ms: 0
    };

    if (probeCandidates.length >= 2) {
      vectorProbe = runVectorCapabilityProbe({
        budgetMs: 22,
        iterations: 7,
        probeWork: () => {
          rerankSearchResults({
            query: probeQuery,
            results: probeCandidates,
            getDocText: (result) => {
              const doc = docByUrl.get(result.url) || {};
              return `${doc.title || ''} ${doc.textSnippet || ''}`.trim();
            }
          });
        }
      });
    }

    return { miniSearch, docByUrl, aliases, vectorProbe };
  }

  function runSearch(state, rawQuery) {
    const normalized = normalizeForSearch(rawQuery);
    if (!normalized) return [];

    const rawResults = state.miniSearch.search(normalized, {
      prefix: true,
      fuzzy: 0.2,
      combineWith: 'OR'
    });

    const deduped = [];
    const seen = new Set();

    for (const item of rawResults) {
      const resolvedUrl = state.aliases[item.url] || item.url;
      if (seen.has(resolvedUrl)) continue;
      seen.add(resolvedUrl);

      const doc = state.docByUrl.get(resolvedUrl) || state.docByUrl.get(item.url) || {};
      deduped.push({
        score: item.score,
        url: resolvedUrl,
        title: doc.title || item.title || resolvedUrl,
        section: doc.section || item.section || 'site',
        dateModified: doc.dateModified || item.dateModified || '',
        textSnippet: doc.textSnippet || item.textSnippet || ''
      });
    }

    deduped.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.url).localeCompare(String(b.url));
    });

    if (!state.vectorProbe?.enabled || deduped.length < 2) {
      return deduped;
    }

    return rerankSearchResults({
      query: normalized,
      results: deduped,
      getDocText: (result) => {
        const doc = state.docByUrl.get(result.url) || {};
        return `${doc.title || ''} ${doc.textSnippet || ''}`.trim() || `${result.title || ''} ${result.textSnippet || ''}`;
      }
    });
  }

  const statePromise = loadState();
  wireKeyboardNavigation();

  async function executeSearch(query) {
    updateStatus('Searching...');
    try {
      const state = await statePromise;
      const results = runSearch(state, query);
      renderResults(state, results, query);
    } catch (error) {
      updateStatus(`Search unavailable: ${error.message}`);
      resultsNode.innerHTML = '';
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
    executeSearch(query);
  });

  const params = new URLSearchParams(window.location.search);
  const initialQuery = params.get('q') || params.get('query') || '';
  if (initialQuery) {
    input.value = initialQuery;
    executeSearch(initialQuery);
  } else {
    updateStatus('Enter a query to search the local index.');
  }
})();
