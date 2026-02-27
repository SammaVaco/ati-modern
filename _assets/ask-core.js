const VELTHUIS_REPLACEMENTS = [
  [/AA/g, 'Ā'],
  [/aa/g, 'ā'],
  [/II/g, 'Ī'],
  [/ii/g, 'ī'],
  [/UU/g, 'Ū'],
  [/uu/g, 'ū'],
  [/"N/g, 'Ṅ'],
  [/"n/g, 'ṅ'],
  [/\.M/g, 'Ṃ'],
  [/\.m/g, 'ṃ'],
  [/~N/g, 'Ñ'],
  [/~n/g, 'ñ'],
  [/\.T/g, 'Ṭ'],
  [/\.t/g, 'ṭ'],
  [/\.D/g, 'Ḍ'],
  [/\.d/g, 'ḍ'],
  [/\.N/g, 'Ṇ'],
  [/\.n/g, 'ṇ'],
  [/\.L/g, 'Ḷ'],
  [/\.l/g, 'ḷ']
];

function velthuisToUnicode(input) {
  let value = String(input || '');
  for (const [pattern, replacement] of VELTHUIS_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value;
}

export function normalizeAskQuery(input) {
  const unicode = velthuisToUnicode(input);
  return unicode
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.~"]/g, '')
    .replace(/aa/g, 'a')
    .replace(/ii/g, 'i')
    .replace(/uu/g, 'u')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeQuery(input) {
  const normalized = normalizeAskQuery(input);
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
  return [...new Set(tokens)];
}

function normalizedContainsToken(text, token) {
  return text.includes(token);
}

function scoreCandidate(candidate, queryNormalized, queryTokens) {
  const lexicalScore = Number(candidate.score || 0);
  const normalizedTitle = normalizeAskQuery(candidate.title || '');
  const normalizedText = normalizeAskQuery(candidate.text || '');
  const normalizedBody = `${normalizedTitle} ${normalizedText}`.trim();

  let tokenHits = 0;
  let titleHits = 0;
  for (const token of queryTokens) {
    if (normalizedContainsToken(normalizedBody, token)) tokenHits += 1;
    if (normalizedContainsToken(normalizedTitle, token)) titleHits += 1;
  }

  const coverage = queryTokens.length ? tokenHits / queryTokens.length : 0;
  const titleCoverage = queryTokens.length ? titleHits / queryTokens.length : 0;
  const phraseBoost = queryNormalized && normalizedBody.includes(queryNormalized) ? 0.65 : 0;

  return lexicalScore * 0.72 + coverage * 1.5 + titleCoverage * 0.35 + phraseBoost;
}

export function rerankAskCandidates({ query, candidates, topK = 8, maxPerUrl = 2 }) {
  const queryNormalized = normalizeAskQuery(query);
  if (!queryNormalized) return [];
  const queryTokens = tokenizeQuery(queryNormalized);
  const safeCandidates = Array.isArray(candidates) ? candidates : [];

  const scored = safeCandidates.map((candidate) => ({
    ...candidate,
    combinedScore: scoreCandidate(candidate, queryNormalized, queryTokens)
  }));

  scored.sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) return b.combinedScore - a.combinedScore;
    if (String(a.url) !== String(b.url)) return String(a.url).localeCompare(String(b.url));
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  const selected = [];
  const perUrlCount = new Map();
  const seenByUrlAndSnippet = new Set();

  for (const item of scored) {
    const url = String(item.url || '').trim();
    if (!url) continue;

    const count = perUrlCount.get(url) || 0;
    if (count >= maxPerUrl) continue;

    const snippetKey = normalizeAskQuery(String(item.text || '').slice(0, 220));
    const dedupeKey = `${url}|${snippetKey}`;
    if (snippetKey && seenByUrlAndSnippet.has(dedupeKey)) continue;

    perUrlCount.set(url, count + 1);
    if (snippetKey) seenByUrlAndSnippet.add(dedupeKey);
    selected.push(item);
    if (selected.length >= topK) break;
  }

  return selected;
}

function splitSentences(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  return clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((value) => value.trim()).filter(Boolean) || [];
}

function summarizeEvidenceText(text, queryTokens) {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return '';

  for (const sentence of sentences) {
    const folded = normalizeAskQuery(sentence);
    if (queryTokens.some((token) => folded.includes(token))) {
      return sentence.length > 260 ? `${sentence.slice(0, 257)}...` : sentence;
    }
  }

  const first = sentences[0];
  return first.length > 260 ? `${first.slice(0, 257)}...` : first;
}

function confidenceFromEvidence(evidence) {
  if (!evidence.length) return 'insufficient';
  const topScore = Number(evidence[0].combinedScore || evidence[0].score || 0);
  if (topScore < 1.4 || evidence.length < 2) return 'insufficient';

  const avgScore = evidence.reduce((sum, row) => sum + Number(row.combinedScore || row.score || 0), 0) / evidence.length;
  if (avgScore >= 4.2 && evidence.length >= 6) return 'high';
  if (avgScore >= 3.0 && evidence.length >= 4) return 'medium';
  return 'low';
}

export function buildDigestFromEvidence({ query, evidence, maxBullets = 4 }) {
  const queryTokens = tokenizeQuery(query);
  const safeEvidence = Array.isArray(evidence) ? evidence : [];
  const confidence = confidenceFromEvidence(safeEvidence);

  if (confidence === 'insufficient') {
    return {
      confidence,
      bullets: []
    };
  }

  const bullets = [];
  const usedUrls = new Set();
  for (const item of safeEvidence) {
    if (bullets.length >= maxBullets) break;
    if (!item?.url) continue;
    if (usedUrls.has(item.url)) continue;

    const summaryText = summarizeEvidenceText(item.text || '', queryTokens);
    if (!summaryText) continue;

    bullets.push({
      text: summaryText,
      citations: [
        {
          url: item.url,
          title: item.title || item.url,
          passageId: item.id || ''
        }
      ]
    });

    usedUrls.add(item.url);
  }

  return {
    confidence: bullets.length > 0 ? confidence : 'insufficient',
    bullets
  };
}

export function runAskQuery(state, rawQuery, options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const startedAt = now();
  const query = String(rawQuery || '').trim();
  const normalizedQuery = normalizeAskQuery(query);

  if (!normalizedQuery) {
    return {
      query,
      normalizedQuery,
      confidence: 'insufficient',
      digestBullets: [],
      evidence: [],
      stats: {
        retrievalMs: 0,
        rerankMs: 0,
        totalMs: 0,
        resultCount: 0
      }
    };
  }

  const retrievalStart = now();
  const rawResults = state.miniSearch.search(normalizedQuery, {
    prefix: true,
    fuzzy: 0.1,
    combineWith: 'OR'
  });
  const retrievalMs = now() - retrievalStart;

  const rerankStart = now();
  const mapped = rawResults.map((row) => {
    const passage = state.passageById.get(row.id) || row;
    const resolvedUrl = state.aliases[passage.url] || passage.url;
    return {
      id: passage.id || row.id,
      score: row.score,
      url: resolvedUrl,
      title: passage.title || row.title || resolvedUrl,
      section: passage.section || row.section || 'site',
      text: passage.text || row.text || ''
    };
  });

  const evidence = rerankAskCandidates({
    query: normalizedQuery,
    candidates: mapped,
    topK: options.topK ?? 10,
    maxPerUrl: options.maxPerUrl ?? 2
  });
  const rerankMs = now() - rerankStart;

  const digest = buildDigestFromEvidence({
    query: normalizedQuery,
    evidence,
    maxBullets: options.maxBullets ?? 4
  });

  return {
    query,
    normalizedQuery,
    confidence: digest.confidence,
    digestBullets: digest.bullets,
    evidence,
    stats: {
      retrievalMs,
      rerankMs,
      totalMs: now() - startedAt,
      resultCount: evidence.length
    }
  };
}
