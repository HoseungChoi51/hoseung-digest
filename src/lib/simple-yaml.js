function stripInlineComment(value) {
  let quote = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : quote || char;
    }
    if (char === '#' && quote === null) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

function parseScalar(rawValue) {
  const value = stripInlineComment(rawValue.trim());

  if (value === '') return '';
  if (value === '[]') return [];
  if (value === '{}') return {};
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseScalar(item));
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function normalizeLines(content) {
  return content
    .split(/\r?\n/)
    .map((raw) => ({
      raw,
      indent: raw.match(/^ */)[0].length,
      text: raw.trim()
    }))
    .filter((line) => line.text && !line.text.startsWith('#'));
}

function nextMeaningfulLine(lines, index) {
  for (let cursor = index; cursor < lines.length; cursor += 1) {
    if (lines[cursor].text) return lines[cursor];
  }
  return null;
}

function parseArray(lines, index, indent) {
  const array = [];
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      cursor += 1;
      continue;
    }
    if (!line.text.startsWith('- ')) break;

    array.push(parseScalar(line.text.slice(2)));
    cursor += 1;
  }

  return [array, cursor];
}

function parseObject(lines, index, indent) {
  const object = {};
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      cursor += 1;
      continue;
    }

    const match = /^([^:]+):(.*)$/.exec(line.text);
    if (!match) {
      cursor += 1;
      continue;
    }

    const key = match[1].trim();
    const rawValue = match[2].trim();

    if (rawValue) {
      object[key] = parseScalar(rawValue);
      cursor += 1;
      continue;
    }

    const next = nextMeaningfulLine(lines, cursor + 1);
    if (!next || next.indent <= line.indent) {
      object[key] = {};
      cursor += 1;
      continue;
    }

    if (next.text.startsWith('- ')) {
      const [array, nextIndex] = parseArray(lines, cursor + 1, next.indent);
      object[key] = array;
      cursor = nextIndex;
    } else {
      const [child, nextIndex] = parseObject(lines, cursor + 1, next.indent);
      object[key] = child;
      cursor = nextIndex;
    }
  }

  return [object, cursor];
}

export function parseYaml(content) {
  const lines = normalizeLines(content);
  const [object] = parseObject(lines, 0, 0);
  return object;
}
