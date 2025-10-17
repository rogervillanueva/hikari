import kuromoji from 'kuromoji';

export interface MorphAnalysisResult {
  surface: string;
  reading?: string;
  pronunciation?: string;
  baseForm: string;
  partOfSpeech: string;
  partOfSpeechDetail1?: string;
  partOfSpeechDetail2?: string;
  partOfSpeechDetail3?: string;
  conjugationType?: string;
  conjugationForm?: string;
  features: string[];
}

export interface DetailedAnalysis {
  original: MorphAnalysisResult[];
  baseWord?: MorphAnalysisResult;
  wordType: string;
  conjugationInfo?: string;
  furiganaSegments: Array<{
    text: string;
    reading?: string;
    isKanji: boolean;
  }>;
}

let tokenizerPromise: Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> | null = null;

// Initialize the tokenizer (this will be cached)
async function getTokenizer(): Promise<kuromoji.Tokenizer<kuromoji.IpadicFeatures>> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      try {
        kuromoji.builder({ dicPath: '/kuromoji/' }).build((err: Error | null, tokenizer: kuromoji.Tokenizer<kuromoji.IpadicFeatures>) => {
          if (err) {
            console.error('Failed to build kuromoji tokenizer:', err);
            reject(new Error('Kuromoji tokenizer initialization failed: ' + err.message));
          } else {
            console.log('Kuromoji tokenizer initialized successfully');
            resolve(tokenizer);
          }
        });
      } catch (error) {
        console.error('Failed to create kuromoji builder:', error);
        reject(new Error('Kuromoji builder creation failed: ' + (error as Error).message));
      }
    });
  }
  return tokenizerPromise;
}

// Convert kuromoji token to our format
function convertToken(token: kuromoji.IpadicFeatures): MorphAnalysisResult {
  return {
    surface: token.surface_form,
    reading: token.reading,
    pronunciation: token.pronunciation,
    baseForm: token.basic_form || token.surface_form,
    partOfSpeech: token.pos,
    partOfSpeechDetail1: token.pos_detail_1,
    partOfSpeechDetail2: token.pos_detail_2,
    partOfSpeechDetail3: token.pos_detail_3,
    conjugationType: token.conjugated_type,
    conjugationForm: token.conjugated_form,
    features: [
      token.pos,
      token.pos_detail_1,
      token.pos_detail_2,
      token.pos_detail_3,
      token.conjugated_type,
      token.conjugated_form,
    ].filter(f => f && f !== '*'),
  };
}

// Generate furigana segments with better distribution for compound kanji
export function generateFuriganaSegments(surface: string, reading?: string): Array<{
  text: string;
  reading?: string;
  isKanji: boolean;
}> {
  if (!reading || reading === surface || reading === '*') {
    return surface.split('').map(char => ({
      text: char,
      reading: undefined,
      isKanji: /[\u4E00-\u9FAF]/.test(char),
    }));
  }

  // Convert katakana to hiragana
  const hiraganaReading = reading.replace(/[\u30A1-\u30F6]/g, (match) => {
    return String.fromCharCode(match.charCodeAt(0) - 0x60);
  });

  const segments: Array<{ text: string; reading?: string; isKanji: boolean }> = [];
  
  // Count kanji characters
  const kanjiCount = surface.split('').filter(char => /[\u4E00-\u9FAF]/.test(char)).length;
  
  if (kanjiCount === 0) {
    return surface.split('').map(char => ({
      text: char,
      reading: undefined,
      isKanji: false,
    }));
  }

  // For pure kanji compounds, distribute reading evenly
  if (surface.split('').every(char => /[\u4E00-\u9FAF]/.test(char))) {
    const readingLength = hiraganaReading.length;
    let readingPos = 0;
    
    for (let i = 0; i < surface.length; i++) {
      const char = surface[i];
      
      // Calculate how much reading this kanji should get
      const remainingKanji = surface.length - i;
      const remainingReading = hiraganaReading.length - readingPos;
      
      let charReadingLength;
      if (i === surface.length - 1) {
        // Last kanji gets all remaining reading
        charReadingLength = remainingReading;
      } else {
        // Distribute evenly among remaining kanji
        charReadingLength = Math.max(1, Math.floor(remainingReading / remainingKanji));
        
        // For common patterns, adjust distribution
        if (surface.length === 2) {
          // Two kanji: try to split more naturally
          charReadingLength = i === 0 ? Math.ceil(readingLength / 2) : remainingReading;
        } else if (surface.length === 3) {
          // Three kanji: distribute as 2-2-remaining or similar
          if (i === 0) charReadingLength = Math.min(3, Math.ceil(readingLength / 3));
          else if (i === 1) charReadingLength = Math.min(3, Math.ceil(remainingReading / 2));
        } else if (surface.length === 4) {
          // Four kanji: try 2-2-1-remaining pattern
          if (i < 2) charReadingLength = Math.min(3, Math.ceil(readingLength / 4) + 1);
          else if (i === 2) charReadingLength = Math.min(2, Math.ceil(remainingReading / 2));
        }
      }
      
      const charReading = hiraganaReading.slice(readingPos, readingPos + charReadingLength);
      readingPos += charReadingLength;
      
      segments.push({
        text: char,
        reading: charReading || undefined,
        isKanji: true,
      });
    }
  } else {
    // Mixed kanji/kana - handle character by character
    let readingPos = 0;
    
    for (let i = 0; i < surface.length; i++) {
      const char = surface[i];
      const isKanji = /[\u4E00-\u9FAF]/.test(char);
      
      if (isKanji) {
        // Find next kana in surface to determine reading boundary
        let nextKanaPos = i + 1;
        while (nextKanaPos < surface.length && /[\u4E00-\u9FAF]/.test(surface[nextKanaPos])) {
          nextKanaPos++;
        }
        
        let charReading = '';
        if (nextKanaPos < surface.length) {
          const nextKana = surface[nextKanaPos];
          const kanaPos = hiraganaReading.indexOf(nextKana, readingPos);
          if (kanaPos >= readingPos) {
            charReading = hiraganaReading.slice(readingPos, kanaPos);
            readingPos = kanaPos;
          }
        } else {
          charReading = hiraganaReading.slice(readingPos);
          readingPos = hiraganaReading.length;
        }
        
        segments.push({ text: char, reading: charReading || undefined, isKanji: true });
      } else {
        segments.push({ text: char, reading: undefined, isKanji: false });
        if (readingPos < hiraganaReading.length && hiraganaReading[readingPos] === char) {
          readingPos++;
        }
      }
    }
  }
  
  return segments;
}

// Get word type description
function getWordTypeDescription(pos: string, detail1?: string, detail2?: string): string {
  switch (pos) {
    case '動詞':
      if (detail1 === '自立') {
        return detail2 === '一段' ? 'Ichidan Verb' : 
               detail2 === '五段・ラ行' ? 'Godan Verb (ra)' :
               detail2 === '五段・ワ行促音便' ? 'Godan Verb (wa)' :
               detail2 === '五段・カ行イ音便' ? 'Godan Verb (ka)' :
               detail2 === '五段・サ行' ? 'Godan Verb (sa)' :
               detail2 === '五段・タ行' ? 'Godan Verb (ta)' :
               detail2 === '五段・ナ行' ? 'Godan Verb (na)' :
               detail2 === '五段・マ行' ? 'Godan Verb (ma)' :
               detail2 === '五段・バ行' ? 'Godan Verb (ba)' :
               detail2 === '五段・ガ行' ? 'Godan Verb (ga)' :
               detail2?.includes('五段') ? 'Godan Verb' :
               'Verb';
      }
      return 'Verb';
    case '形容詞':
      return detail1 === '自立' ? 'I-Adjective' : 'Adjective';
    case '形容動詞':
      return 'Na-Adjective';
    case '名詞':
      return detail1 === '代名詞' ? 'Pronoun' :
             detail1 === '固有名詞' ? 'Proper Noun' :
             'Noun';
    case '副詞':
      return 'Adverb';
    case '助詞':
      return 'Particle';
    case '助動詞':
      return 'Auxiliary Verb';
    case '連体詞':
      return 'Adnominal';
    case '接続詞':
      return 'Conjunction';
    case '感動詞':
      return 'Interjection';
    default:
      return pos || 'Unknown';
  }
}

// Get conjugation description with better analysis for compound forms
function getConjugationDescription(conjugationType?: string, conjugationForm?: string, surface?: string, tokens?: kuromoji.IpadicFeatures[]): string | undefined {
  if (!conjugationType || conjugationType === '*' || !conjugationForm || conjugationForm === '*') {
    // For verbs ending in る, める, etc., if no conjugation info, it's likely dictionary form
    if (surface && (/る$/.test(surface) || /める$/.test(surface) || /す$/.test(surface))) {
      return 'Dictionary form';
    }
    return undefined;
  }
  
  // Check for progressive forms (て-form + いる/いた)
  if (surface && tokens) {
    // Look for progressive patterns
    if (surface.includes('ている')) {
      return 'Present progressive';
    }
    if (surface.includes('ていた')) {
      return 'Past progressive';
    }
    if (surface.includes('ていて')) {
      return 'Te-form progressive';
    }
    if (surface.includes('てある')) {
      return 'Resultative state';
    }
  }
  
  // Special handling for compound verbs like 回り始める
  if (surface && surface.includes('始める')) {
    return 'Dictionary form (compound verb)';
  }
  
  // Map common conjugation patterns to English descriptions
  const conjugationMap: Record<string, string> = {
    '連用タ接続': 'Past tense',
    '連用形': 'Stem form',
    '基本形': 'Dictionary form',
    '未然形': 'Imperfective form',
    '仮定形': 'Conditional form',
    '命令形': 'Imperative form',
    '体言接続': 'Noun connection',
    '連体形': 'Adnominal form',
    'ガル接続': 'Garu connection',
    'ヌル接続': 'Nuru connection',
  };
  
  return conjugationMap[conjugationForm] || `${conjugationForm} form`;
}

// Analyze Japanese text and return detailed information
export async function analyzeJapaneseText(text: string): Promise<DetailedAnalysis> {
  try {
    const tokenizer = await getTokenizer();
    const tokens = tokenizer.tokenize(text);
    
    if (tokens.length === 0) {
      return {
        original: [],
        wordType: 'Unknown',
        furiganaSegments: text.split('').map(char => ({
          text: char,
          reading: undefined,
          isKanji: /[一-龯]/.test(char),
        })),
      };
    }
    
    const morphResults = tokens.map(convertToken);
    const firstToken = morphResults[0];
    
    // Find the base form for conjugated verbs/adjectives
    let baseWord: MorphAnalysisResult | undefined;
    
    // Check if this is a conjugated form that needs a base form
    const needsBaseForm = morphResults.some(token => {
      const isVerb = token.partOfSpeech === '動詞';
      const isAdjective = token.partOfSpeech === '形容詞' || token.partOfSpeech === '形容動詞';
      const isConjugated = token.conjugationForm && token.conjugationForm !== '*' && token.conjugationForm !== '基本形';
      const isDifferentFromBase = token.baseForm && token.baseForm !== token.surface;
      
      // Also check for specific conjugated patterns
      const hasConjugatedEnding = /[たてで]$/.test(text) || // past/te-form endings
                                  /ている|ていた|ておく|てある/.test(text) || // progressive/resultative
                                  /ます|ました|ません|ませんでした/.test(text) || // polite forms
                                  /だろう|でしょう/.test(text) || // presumptive
                                  /れば|なら/.test(text) || // conditional
                                  /そう|らしい/.test(text); // hearsay/appearance
      
      return (isVerb || isAdjective) && (isConjugated || isDifferentFromBase || hasConjugatedEnding);
    });
    
    if (needsBaseForm) {
      // Try to get base form from the first verb/adjective token
      const mainToken = morphResults.find(token => 
        token.partOfSpeech === '動詞' || 
        token.partOfSpeech === '形容詞' || 
        token.partOfSpeech === '形容動詞'
      ) || firstToken;
      
      if (mainToken.baseForm && mainToken.baseForm !== text) {
        // Try to analyze the base form
        const baseTokens = tokenizer.tokenize(mainToken.baseForm);
        if (baseTokens.length > 0) {
          baseWord = convertToken(baseTokens[0]);
        }
      } else {
        // Fallback: try to derive base form from surface form
        let estimatedBase = text;
        
        // Simple conjugation reversal patterns
        if (text.endsWith('ていた')) {
          estimatedBase = text.replace(/ていた$/, 'つ');
        } else if (text.endsWith('ている')) {
          estimatedBase = text.replace(/ている$/, 'つ');
        } else if (text.endsWith('った')) {
          estimatedBase = text.replace(/った$/, 'う');
        } else if (text.endsWith('った')) {
          estimatedBase = text.replace(/った$/, 'つ');
        } else if (text.endsWith('んだ')) {
          estimatedBase = text.replace(/んだ$/, 'ぬ');
        }
        
        if (estimatedBase !== text) {
          const baseTokens = tokenizer.tokenize(estimatedBase);
          if (baseTokens.length > 0) {
            baseWord = convertToken(baseTokens[0]);
          }
        }
      }
    }
    
    // Generate furigana segments for the entire text
    let furiganaSegments: Array<{ text: string; reading?: string; isKanji: boolean }> = [];
    
    if (morphResults.length === 1) {
      // Single word - use its reading
      furiganaSegments = generateFuriganaSegments(firstToken.surface, firstToken.reading);
    } else {
      // Multiple words - combine their segments
      let currentPos = 0;
      for (const token of morphResults) {
        const tokenSegments = generateFuriganaSegments(token.surface, token.reading);
        furiganaSegments.push(...tokenSegments);
        currentPos += token.surface.length;
      }
    }
    
    const wordType = getWordTypeDescription(
      firstToken.partOfSpeech,
      firstToken.partOfSpeechDetail1,
      firstToken.partOfSpeechDetail2
    );
    
    const conjugationInfo = getConjugationDescription(
      firstToken.conjugationType,
      firstToken.conjugationForm,
      text,
      tokens
    );
    
    return {
      original: morphResults,
      baseWord,
      wordType,
      conjugationInfo,
      furiganaSegments,
    };
    
  } catch (error) {
    console.error('Failed to analyze Japanese text:', error);
    
    // Fallback analysis
    return {
      original: [{
        surface: text,
        baseForm: text,
        partOfSpeech: 'Unknown',
        features: [],
      }],
      wordType: 'Unknown',
      furiganaSegments: text.split('').map(char => ({
        text: char,
        reading: undefined,
        isKanji: /[一-龯]/.test(char),
      })),
    };
  }
}