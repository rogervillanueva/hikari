const ABBREVIATIONS = [
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'fig',
  'no',
  'dept',
  'est',
  'approx',
  'appt',
  'inc',
  'ltd',
  'co',
  'corp',
  'jan',
  'feb',
  'mar',
  'apr',
  'jun',
  'jul',
  'aug',
  'sep',
  'sept',
  'oct',
  'nov',
  'dec',
  'mon',
  'tue',
  'tues',
  'wed',
  'thu',
  'thur',
  'thurs',
  'fri',
  'sat',
  'sun',
  'u.s',
  'u.k',
  'u.n',
  'st',
  'mt',
];

const ESCAPED_ABBREVIATIONS = ABBREVIATIONS.map((abbr) => abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const ABBREVIATION_PATTERN = new RegExp(
  `(?:\\b(?:${ESCAPED_ABBREVIATIONS.join('|')})\\.|\\b(?:[A-Za-z]\\.){2,}|\\b[A-Za-z]\\.)$`,
  'i'
);

type TokenKind = 'word' | 'whitespace' | 'terminal' | 'ellipsis' | 'quote';

interface Token {
  value: string;
  kind: TokenKind;
}

const TOKEN_REGEX = /(\u2026|\.\.\.)|([.!?])|(["'“”‘’«»(){}\[\]])|(\s+)|([^\s]+)/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let match: RegExpExecArray | null;

  while ((match = TOKEN_REGEX.exec(text))) {
    const [value, ellipsis, terminal, quote, whitespace] = match;
    if (ellipsis) {
      tokens.push({ value, kind: 'ellipsis' });
    } else if (terminal) {
      tokens.push({ value, kind: 'terminal' });
    } else if (quote) {
      tokens.push({ value, kind: 'quote' });
    } else if (whitespace) {
      tokens.push({ value, kind: 'whitespace' });
    } else {
      tokens.push({ value, kind: 'word' });
    }
  }

  return tokens;
}

function endsWithAbbreviation(text: string): boolean {
  const trimmed = text.trimEnd();
  return ABBREVIATION_PATTERN.test(trimmed);
}

function shouldAttachToSentence(token: Token): boolean {
  if (token.kind === 'quote') {
    return true;
  }

  if (token.kind === 'word') {
    return /^[)\]}»”’]+$/.test(token.value);
  }

  return false;
}

function isTerminalCandidate(token: Token): boolean {
  return token.kind === 'terminal' || token.kind === 'ellipsis';
}

function hasTerminal(text: string): boolean {
  return /[.!?\u2026]/.test(text);
}

export function splitIntoSentences(text: string): string[] {
  if (!text.trim()) {
    return [];
  }

  const tokens = tokenize(text);
  const sentences: string[] = [];
  let current = '';
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.kind === 'whitespace' && token.value.includes('\n')) {
      const candidate = current.trim();
      if (candidate && !hasTerminal(candidate)) {
        sentences.push(candidate);
        current = '';
        i++;
        continue;
      }
    }

    current += token.value;

    if (isTerminalCandidate(token)) {
      const candidate = current.trimEnd();

      if (token.kind === 'terminal' && token.value === '.' && endsWithAbbreviation(candidate)) {
        i++;
        continue;
      }

      let lookahead = i + 1;
      while (lookahead < tokens.length && shouldAttachToSentence(tokens[lookahead])) {
        current += tokens[lookahead].value;
        i = lookahead;
        lookahead += 1;
      }

      const sentence = current.trim();
      if (sentence) {
        sentences.push(sentence);
      }

      current = '';
    }

    i += 1;
  }

  const remainder = current.trim();
  if (remainder) {
    sentences.push(remainder);
  }

  return sentences;
}

export default splitIntoSentences;
