const TODO_PATTERN = /^\s*(?:-\s*)?\[\s*([xX]?)\s*\]\s*(.+)$/;

function formatMarkdownListItem(text) {
  const normalizedText = typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : '';
  if (!normalizedText) {
    return '-';
  }

  const lines = normalizedText.split('\n');
  const firstLine = lines[0].trim();
  const firstLineIsBullet = firstLine.startsWith('- ') || TODO_PATTERN.test(firstLine);
  const formattedFirstLine = firstLineIsBullet ? firstLine : `- ${firstLine}`;
  const continuationLines = lines.slice(1).map((line) => `  ${line}`);

  return [formattedFirstLine, ...continuationLines].join('\n');
}

function parseActionItems(notes) {
  if (!Array.isArray(notes)) {
    return [];
  }

  return notes.flatMap((note) => {
    const match = typeof note?.text === 'string' ? note.text.match(TODO_PATTERN) : null;
    if (!match) {
      return [];
    }

    return [
      {
        checked: match[1].toLowerCase() === 'x',
        label: match[2].trim(),
      },
    ];
  });
}

function isChecklistNote(text) {
  return typeof text === 'string' && TODO_PATTERN.test(text.trim());
}

export function formatTopicMarkdown(topic) {
  if (!topic) {
    return '';
  }

  const title = typeof topic.name === 'string' && topic.name.trim() ? topic.name.trim() : 'Untitled topic';
  const noteLines = Array.isArray(topic.notes)
    ? topic.notes.flatMap((note) => {
      if (typeof note?.text !== 'string' || !note.text.trim() || isChecklistNote(note.text)) {
        return [];
      }

      return [formatMarkdownListItem(note.text)];
    })
    : [];
  const actionItems = parseActionItems(topic.notes);
  let markdown = `## ${title}`;

  if (noteLines.length) {
    markdown += `\n${noteLines.join('\n')}`;
  }

  if (actionItems.length) {
    markdown += `${noteLines.length ? '\n\n' : '\n'}### Action items\n${actionItems
      .map((item) => `- [${item.checked ? 'x' : ' '}] ${item.label}`)
      .join('\n')}`;
  }

  return markdown;
}

export function formatAgendaMarkdown(topics) {
  if (!Array.isArray(topics) || !topics.length) {
    return '';
  }

  return topics
    .map((topic) => formatTopicMarkdown(topic))
    .filter(Boolean)
    .join('\n\n');
}

export async function writeTextToClipboard(
  text,
  { navigatorRef = globalThis.navigator, documentRef = globalThis.document } = {},
) {
  if (typeof text !== 'string' || !text.length) {
    return false;
  }

  const clipboard = navigatorRef?.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the legacy selection flow below.
    }
  }

  if (!documentRef?.body) {
    return false;
  }

  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';

  documentRef.body.append(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (typeof textarea.setSelectionRange === 'function') {
      textarea.setSelectionRange(0, text.length);
    }

    return typeof documentRef.execCommand === 'function'
      ? documentRef.execCommand('copy') !== false
      : false;
  } finally {
    textarea.remove();
  }
}
