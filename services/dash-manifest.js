const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { createHash } = require('node:crypto');

const children = node => Array.from(node.childNodes || []).filter(n => n.nodeType === 1);
const named = (node, name) => children(node).filter(n => n.localName === name);
const addressTypes = ['SegmentTemplate', 'SegmentList', 'SegmentBase'];
const variablePattern = /\$\$|\$(RepresentationID|Bandwidth|Number|Time)(?:%0\d+d)?\$/g;

function registerResource(template, session, proxyBase) {
  session.resources ||= new Map();
  const variables = [];
  template.replace(variablePattern, (match, name) => {
    if (name && !variables.includes(match)) variables.push(match);
    return match;
  });
  const id = createHash('sha256').update(template).digest('hex').slice(0, 24);
  session.resources.set(id, { template, variables });
  // Keep older manifests usable while in-flight requests finish, with bounded memory.
  while (session.resources.size > 8192) session.resources.delete(session.resources.keys().next().value);
  return `${proxyBase}r/${id}${variables.map(v => '/' + v).join('')}`;
}

function resolveDashResource(path, session) {
  const [kind, id, ...values] = path.split('/');
  const entry = kind === 'r' && session.resources && session.resources.get(id);
  if (!entry || values.length !== entry.variables.length) throw new Error('Risorsa DASH non registrata');
  return entry.template.replace(variablePattern, (match, name) => {
    if (!name) return '$';
    const value = values[entry.variables.indexOf(match)];
    if (!/^[a-zA-Z0-9_.-]+$/.test(value)) throw new Error('Variabile DASH non valida');
    return value;
  });
}

function prepareDashManifest(xml, sourceUrl, session, proxyBase, selectTracks = false) {
  const doc = new DOMParser({ onError(level) {
    if (level !== 'warning') throw new Error('Manifest MPD XML non valido');
  } }).parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'MPD') throw new Error('La sorgente non è un manifest MPD');
  const bases = new Map();
  const elements = [];
  function visit(node, inheritedBase) {
    elements.push(node);
    let base = inheritedBase;
    if (node.hasAttribute('xml:base')) base = new URL(node.getAttribute('xml:base'), base).href;
    const baseNode = named(node, 'BaseURL')[0];
    if (baseNode) base = new URL(baseNode.textContent.trim(), base).href;
    bases.set(node, base);
    for (const child of children(node)) visit(child, base);
  }
  visit(root, sourceUrl);

  // Materialize inherited addressing at each Representation before rewriting URLs.
  // A relative template at AdaptationSet scope can use a different BaseURL per track.
  for (const rep of elements.filter(n => n.localName === 'Representation')) {
    const ancestors = [];
    for (let n = rep; n && n.nodeType === 1; n = n.parentNode) ancestors.unshift(n);
    let descriptor = null;
    for (const ancestor of ancestors) {
      const local = children(ancestor).find(n => addressTypes.includes(n.localName));
      if (!local) continue;
      if (!descriptor || descriptor.localName !== local.localName) descriptor = local.cloneNode(true);
      else {
        for (const attr of Array.from(local.attributes)) descriptor.setAttribute(attr.name, attr.value);
        for (const child of children(local)) {
          for (const previous of named(descriptor, child.localName)) descriptor.removeChild(previous);
        }
        for (const child of children(local)) descriptor.appendChild(child.cloneNode(true));
      }
    }
    for (const child of children(rep).filter(n => addressTypes.includes(n.localName))) rep.removeChild(child);
    if (descriptor) {
      function rewrite(node) {
        for (const attr of ['media', 'initialization', 'sourceURL', 'index']) {
          if (node.hasAttribute(attr)) {
            const address = node.getAttribute(attr).replace(/\$RepresentationID\$/g, () => rep.getAttribute('id'));
            const target = new URL(address, bases.get(rep)).href;
            node.setAttribute(attr, registerResource(target, session, proxyBase));
          }
        }
        children(node).forEach(rewrite);
      }
      rewrite(descriptor);
      rep.appendChild(descriptor);
    }
    const baseNode = doc.createElementNS(root.namespaceURI, 'BaseURL');
    baseNode.textContent = registerResource(bases.get(rep), session, proxyBase);
    rep.insertBefore(baseNode, rep.firstChild);
  }
  // Remove only the ORIGINAL inherited nodes; new per-track nodes above stay intact.
  for (const node of elements) {
    if (node.localName === 'UTCTiming' && /:http-/.test(node.getAttribute('schemeIdUri') || '')) {
      node.setAttribute('value', registerResource(new URL(node.getAttribute('value'), sourceUrl).href, session, proxyBase));
    }
    if (node.localName === 'BaseURL' || node.localName === 'Location' ||
        (addressTypes.includes(node.localName) && node.parentNode?.localName !== 'Representation')) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
    node.removeAttribute('xml:base');
  }
  if (selectTracks) {
    for (const set of elements.filter(n => n.localName === 'AdaptationSet')) {
      const reps = named(set, 'Representation');
      const video = set.getAttribute('contentType') === 'video' ||
        /video/.test(set.getAttribute('mimeType') || '') || reps.some(r => r.hasAttribute('height'));
      if (video && reps.length > 1) {
        const hd = reps.filter(r => Number(r.getAttribute('height') || set.getAttribute('height')) <= 1080);
        const candidates = hd.length ? hd : reps;
        candidates.sort((a, b) => Number(b.getAttribute('bandwidth')) - Number(a.getAttribute('bandwidth')));
        for (const rep of reps) if (rep !== candidates[0]) set.removeChild(rep);
      }
    }
  }
  // Keep type, Period durations, startNumber, PTO, repeats and timestamps unchanged.
  // Altering them invents segment URLs and can desynchronize audio and video.
  return new XMLSerializer().serializeToString(doc);
}

module.exports = { prepareDashManifest, resolveDashResource };
