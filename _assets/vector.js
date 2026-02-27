function hashToken(token, seed = 2166136261) {
  let hash = seed >>> 0;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function embedText(text, dims = 96) {
  const vector = new Float32Array(dims);
  const tokens = tokenize(text);
  if (!tokens.length) return vector;

  for (const token of tokens) {
    const h1 = hashToken(token);
    const h2 = hashToken(token, 374761393);
    const index = h1 % dims;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vector[index] += sign;
  }

  let sumSquares = 0;
  for (let i = 0; i < dims; i += 1) {
    sumSquares += vector[i] * vector[i];
  }

  const norm = Math.sqrt(sumSquares);
  if (norm > 0) {
    for (let i = 0; i < dims; i += 1) {
      vector[i] /= norm;
    }
  }
  return vector;
}

function cosineSimilarity(a, b) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function rerankSearchResults({
  query,
  results,
  getDocText,
  lexicalWeight = 0.68,
  vectorWeight = 0.32,
  dims = 96
}) {
  const queryVector = embedText(query, dims);
  const safeResults = Array.isArray(results) ? results : [];

  const ranked = safeResults.map((result) => {
    const docText = getDocText ? getDocText(result) : `${result.title || ''} ${result.textSnippet || ''}`;
    const docVector = embedText(docText, dims);
    const vectorScore = cosineSimilarity(queryVector, docVector);
    const combinedScore = Number(result.score || 0) * lexicalWeight + vectorScore * vectorWeight;
    return {
      ...result,
      vectorScore,
      combinedScore
    };
  });

  ranked.sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) return b.combinedScore - a.combinedScore;
    if (b.score !== a.score) return b.score - a.score;
    return String(a.url || '').localeCompare(String(b.url || ''));
  });

  return ranked;
}

export function runVectorCapabilityProbe({
  budgetMs = 22,
  iterations = 8,
  now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()),
  probeWork = () => {}
} = {}) {
  const samplesMs = [];

  for (let i = 0; i < iterations; i += 1) {
    const start = now();
    probeWork();
    const elapsed = Math.max(0, now() - start);
    samplesMs.push(elapsed);
  }

  const p95Ms = percentile(samplesMs, 95);
  const p50Ms = percentile(samplesMs, 50);

  return {
    enabled: p95Ms <= budgetMs,
    budgetMs,
    iterations,
    p50Ms,
    p95Ms,
    maxMs: samplesMs.length ? Math.max(...samplesMs) : 0
  };
}
