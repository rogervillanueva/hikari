'use client';

interface FuriganaSegment {
  text: string;
  reading?: string;
  isKanji: boolean;
}

interface FuriganaTextProps {
  segments: FuriganaSegment[];
  className?: string;
  furiganaClassName?: string;
}

export function FuriganaText({ segments, className = '', furiganaClassName = '' }: FuriganaTextProps) {
  return (
    <div className={`inline-block ${className}`}>
      <table style={{ borderCollapse: 'collapse', lineHeight: '1' }}>
        <tbody>
          {/* Furigana row */}
          <tr>
            {segments.map((segment, index) => (
              <td 
                key={`furigana-${index}`}
                className={`text-center align-bottom ${furiganaClassName}`}
                style={{
                  fontSize: '0.6em',
                  color: '#666',
                  padding: '0 1px',
                  height: '1.2em',
                  verticalAlign: 'bottom',
                  lineHeight: '1.2'
                }}
              >
                {segment.reading && segment.isKanji ? segment.reading : ''}
              </td>
            ))}
          </tr>
          {/* Character row */}
          <tr>
            {segments.map((segment, index) => (
              <td 
                key={`char-${index}`}
                className="text-center align-top"
                style={{
                  padding: '0 1px',
                  verticalAlign: 'top',
                  lineHeight: '1.2'
                }}
              >
                {segment.text}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}