import path from 'node:path';

const label = value => value.trim().replace(/\s+/gu, ' ').toLowerCase();
const masked = value => value.replace(/[^\r\n]/g, ' ');

function prose(contents) {
  let fence;
  return contents.split(/(?<=\n)/u).map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker && !fence) { fence = marker; return masked(line); }
    if (marker && marker[0] === fence?.[0] && marker.length >= fence.length) {
      fence = null;
      return masked(line);
    }
    return fence || /^(?: {4}|\t)/u.test(line) ? masked(line) : line;
  }).join('');
}

export function headingAnchors(contents) {
  const lines = prose(contents).split(/\r?\n/u);
  const counts = new Map();
  const anchors = new Set();
  for (const [index, line] of lines.entries()) {
    const atx = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
    const setext = index > 0 && /^\s{0,3}(?:=+|-+)\s*$/u.test(line) &&
      lines[index - 1].trim() && !/^\s*[|>-]/u.test(lines[index - 1]) ?
      lines[index - 1].trim() : null;
    const heading = atx ?? setext;
    if (!heading) continue;
    const slug = heading.replace(/<[^>]*>/gu, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/&amp;/gu, '&').replace(/&#(\d+);/gu,
        (entity, code) => Number(code) <= 0x10ffff ?
          String.fromCodePoint(Number(code)) : entity)
      .toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, '').replace(/\s/gu, '-');
    let suffix = counts.get(slug) ?? 0;
    let anchor = suffix ? `${slug}-${suffix}` : slug;
    while (anchors.has(anchor)) anchor = `${slug}-${++suffix}`;
    counts.set(slug, suffix + 1);
    anchors.add(anchor);
  }
  for (const match of prose(contents).matchAll(/<a\s+(?:id|name)=["']([^"']+)["']\s*><\/a>/gu)) {
    anchors.add(match[1]);
  }
  return anchors;
}

export function markdownLinks(contents) {
  const diagnostics = [];
  const destinations = [];
  let text = prose(contents).replace(/(`+)[\s\S]*?\1/gu, masked);
  const references = new Map();
  text = text.replace(/^\s{0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+["'][^\n]*["'])?\s*$/gmu,
    (match, name, target, offset) => {
      const key = label(name);
      if (references.has(key)) diagnostics.push(`Duplicate reference: ${name}`);
      const angled = target.startsWith('<') && target.endsWith('>');
      const href = angled ? target.slice(1, -1) : target;
      references.set(key, href);
      const start = offset + match.indexOf(target, match.indexOf(']:') + 2) + (angled ? 1 : 0);
      destinations.push({ href, start, end: start + href.length });
      return masked(match);
    });
  if (/<(?:a|img)\s+[^>]*(?:href|src)\s*=/iu.test(text) ||
    /<https?:\/\/[^>]+>/iu.test(text)) {
    diagnostics.push('Unsupported HTML/autolink; use a Markdown link');
  }
  const links = [];
  const used = new Set();
  for (const match of text.matchAll(/!?\[([^\]\n]*)\](?:\(([^)\n]*)\)|\[([^\]\n]*)\])?/gu)) {
    if (/^(?: |x|X)$/u.test(match[1]) && /^\s*[-*]\s+$/u.test(
      text.slice(text.lastIndexOf('\n', match.index) + 1, match.index))) continue;
    if (match[2] !== undefined) {
      const target = /^(?:<([^<>]+)>|([^\s<>]+))(?:\s+["'][^"']*["'])?$/u.exec(match[2]);
      if (!target || /[()]/u.test(target[1] ?? target[2])) {
        diagnostics.push(`Unsupported or malformed link destination: ${match[0]}`);
      } else {
        const href = target[1] ?? target[2];
        links.push(href);
        const start = match.index + match[0].indexOf('](') + 2 +
          (target[1] === undefined ? 0 : 1);
        destinations.push({ href, start, end: start + href.length });
      }
    } else {
      const name = label(match[3] || match[1]);
      if (references.has(name)) { links.push(references.get(name)); used.add(name); }
      else diagnostics.push(`Unresolved reference: ${match[3] || match[1]}`);
    }
  }
  for (const [name, href] of references) if (!used.has(name)) links.push(href);
  return { links, diagnostics, destinations };
}

function target(file, href) {
  if (/^https?:\/\//iu.test(href)) {
    const url = new URL(href);
    if (url.username || url.password) throw new Error('invalid external URL');
    return { external: true };
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith('/') || href.includes('\\')) {
    throw new Error('unsupported link');
  }
  const [pathname, rawFragment] = href.split('#');
  const localPath = decodeURIComponent(pathname.split('?')[0]);
  const filePath = localPath ? path.posix.normalize(path.posix.join(
    path.posix.dirname(file), localPath)) : file;
  if (filePath === '..' || filePath.startsWith('../') ||
    path.posix.isAbsolute(filePath) || filePath.includes('\\') || filePath.includes(':')) {
    throw new Error('link escapes repository');
  }
  if (filePath.split('/').some(part => ['.git', '.sdlc', '.test-data'].includes(part))) {
    throw new Error('operational state is not a reader link');
  }
  return { file: filePath, fragment: rawFragment === undefined ? null : decodeURIComponent(rawFragment) };
}

export function rebaseDocumentationLinks(contents, from, to) {
  const parsed = markdownLinks(contents);
  if (parsed.diagnostics.length) throw new Error(parsed.diagnostics.join('\n'));
  let result = contents;
  for (const destination of parsed.destinations.sort((left, right) => right.start - left.start)) {
    const resolved = target(from, destination.href);
    if (resolved.external) continue;
    const suffix = destination.href.match(/[?#].*$/u)?.[0] ?? '';
    const relative = path.posix.relative(path.posix.dirname(to), resolved.file);
    const replacement = (resolved.file === to ? '' : relative) + suffix;
    result = result.slice(0, destination.start) + replacement + result.slice(destination.end);
  }
  return result;
}

export async function checkDocumentationLinks(documents, lookup) {
  const diagnostics = [];
  const edges = new Map();
  const pending = new Map(documents);
  const anchors = new Map();
  const targets = new Map();
  const read = async file => {
    if (!targets.has(file)) targets.set(file, await lookup(file));
    return targets.get(file);
  };
  for (const [file, contents] of pending) {
    const parsed = markdownLinks(contents);
    diagnostics.push(...parsed.diagnostics.map(message => `${file}: ${message}`));
    edges.set(file, []);
    for (const href of parsed.links) {
      let resolved;
      try { resolved = target(file, href); }
      catch (error) { diagnostics.push(`${file}: ${error.message} ${href}`); continue; }
      if (resolved.external) continue;
      let entry = await read(resolved.file);
      if (entry?.directory) {
        resolved.file = path.posix.join(resolved.file, 'README.md');
        entry = await read(resolved.file);
      }
      if (!entry) {
        diagnostics.push(`${file}: missing or unsafe link ${href}`);
        continue;
      }
      edges.get(file).push(resolved.file);
      if (resolved.file.endsWith('.md')) {
        const text = String(entry.contents);
        if (!pending.has(resolved.file)) pending.set(resolved.file, text);
        if (resolved.fragment) {
          if (!anchors.has(resolved.file)) anchors.set(resolved.file, headingAnchors(text));
          if (!anchors.get(resolved.file).has(resolved.fragment)) {
            diagnostics.push(`${file}: missing anchor ${href}`);
          }
        }
      } else if (resolved.fragment) {
        diagnostics.push(`${file}: unsupported non-Markdown fragment ${href}`);
      }
    }
  }
  return { diagnostics: [...new Set(diagnostics)].sort(), edges };
}

export function checkPackagedDocumentation(files, { managedInstructions } = {}) {
  const graph = new Map(files);
  if (managedInstructions !== undefined) graph.set('copilot-instructions.md', Buffer.from(managedInstructions));
  const documents = new Map([...graph].filter(([file]) =>
    file.endsWith('.md')).map(([file, contents]) => [file, contents.toString('utf8')]));
  return checkDocumentationLinks(documents, async file => {
    if (graph.has(file)) return { contents: graph.get(file).toString('utf8') };
    if ([...graph.keys()].some(key => key.startsWith(`${file}/`))) return { directory: true };
    return null;
  });
}
