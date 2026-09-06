function redactDiagnostic(value) {
  return String(value)
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL omesso]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[chiave omessa]');
}

// Preserve complete diagnostic lines before long signed URLs can evict the error.
function createFfmpegDiagnostics() {
  let pending = '';
  let skipping = false;
  const first = [];
  const tail = [];
  let count = 0;
  function add(line) {
    if (!line.trim()) return;
    const safe = redactDiagnostic(line).slice(0, 1500);
    count++;
    if (first.length < 20) first.push(safe);
    else {
      tail.push(safe);
      if (tail.length > 20) tail.shift();
    }
  }
  return {
    push(chunk) {
      for (const part of String(chunk).split(/(?<=\n)/)) {
        if (!skipping) pending += part;
        if (pending.length > 65536) {
          pending = '';
          skipping = true;
        }
        if (part.endsWith('\n')) {
          add(skipping ? '[riga diagnostica troppo lunga omessa]' : pending.trimEnd());
          pending = '';
          skipping = false;
        }
      }
    },
    text() {
      if (pending || skipping) {
        add(skipping ? '[riga diagnostica troppo lunga omessa]' : pending);
        pending = '';
        skipping = false;
      }
      const omitted = count > 40 ? [`[${count - 40} righe intermedie omesse]`] : [];
      return [...first, ...omitted, ...tail].join('\n');
    }
  };
}

// Kodi headers may be URL-encoded pairs, plain pairs, or HTTP header lines.
function parseStreamHeaders(value) {
  const result = {};
  const add = (name, val) => {
    name = String(name).trim();
    val = String(val).trim();
    if (/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) && !/[\r\n]/.test(val)) result[name] = val;
  };
  const decode = text => {
    try { return decodeURIComponent(text); } catch (_) { return text; }
  };
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([name, val]) => add(name, val));
  } else if (typeof value === 'string') {
    if (/^[^=:\r\n]+\s*:/.test(value)) {
      for (const line of value.split(/\r?\n/)) {
        const pos = line.indexOf(':');
        if (pos > 0) add(line.slice(0, pos), line.slice(pos + 1));
      }
    } else {
      for (const pair of value.split('&')) {
        const pos = pair.indexOf('=');
        if (pos > 0) add(decode(pair.slice(0, pos)), decode(pair.slice(pos + 1)));
      }
    }
  }
  return result;
}

function requireMpdDocument(data) {
  if (typeof data !== 'string' || !/<(?:[\w.-]+:)?MPD\b/i.test(data)) {
    throw new Error('La sorgente non ha restituito un manifest MPD (possibile pagina HTML o risposta vuota)');
  }
}

module.exports = { redactDiagnostic, createFfmpegDiagnostics, parseStreamHeaders, requireMpdDocument };
