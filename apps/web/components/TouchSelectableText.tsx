'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { ACTIVE_TRANSLATION_PROVIDER } from '@/lib/config';
import { translateSentences } from '@/utils/translateSentences';
import { analyzeJapaneseText, generateFuriganaSegments, type DetailedAnalysis } from '../lib/morphology';
import { FuriganaText } from '@/components/FuriganaText';
import { smartCache } from '@/lib/smart-cache';
import { X } from 'lucide-react';
import type { TranslationDirection } from '@/providers/translation/base';

interface TouchSelectableTextProps {
  text: string;
  documentId: string;
  direction: TranslationDirection;
  className?: string;
}

interface SelectionState {
  startIndex: number;
  endIndex: number;
  isSelecting: boolean;
}

interface TranslationPopup {
  text: string;
  translation: string;
  analysis: DetailedAnalysis;
  x: number;
  y: number;
  isDragging?: boolean;
  dragOffset?: { x: number; y: number };
}

export function TouchSelectableText({ 
  text, 
  documentId, 
  direction, 
  className = '' 
}: TouchSelectableTextProps) {
  const [selection, setSelection] = useState<SelectionState>({
    startIndex: -1,
    endIndex: -1,
    isSelecting: false,
  });
  const [popup, setPopup] = useState<TranslationPopup | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [popupDragging, setPopupDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const charactersRef = useRef<HTMLSpanElement[]>([]);
  const longPressTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isDraggingRef = useRef(false);

  // Clear selection when text changes
  useEffect(() => {
    setSelection({ startIndex: -1, endIndex: -1, isSelecting: false });
    setPopup(null);
    charactersRef.current = [];
  }, [text]);

  // Clear any pending timeouts on unmount
  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) {
        clearTimeout(longPressTimeoutRef.current);
      }
    };
  }, []);

  // Calculate optimal popup position within viewport
  const calculatePopupPosition = useCallback((x: number, y: number) => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 800;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
    const popupWidth = 400; // Approximate popup width
    const popupHeight = 400; // Approximate popup height
    const margin = 20; // Margin from viewport edges

    let popupX = x;
    let popupY = y;

    // Adjust X position to keep popup within viewport
    if (popupX + popupWidth + margin > viewportWidth) {
      // If popup would go off the right edge, position it to the left of the cursor
      popupX = Math.max(margin, x - popupWidth);
    } else {
      // Keep some margin from the left edge
      popupX = Math.max(margin, popupX);
    }

    // Adjust Y position to keep popup within viewport
    if (popupY + popupHeight + margin > viewportHeight) {
      // If popup would go off the bottom edge, position it above the cursor
      popupY = Math.max(margin, y - popupHeight - 20);
    } else {
      // Position below the cursor with some offset
      popupY = Math.max(margin, popupY + 20);
    }

    return { x: popupX, y: popupY };
  }, []);

  const getCharacterIndexFromPoint = useCallback((x: number, y: number): number => {
    const container = containerRef.current;
    if (!container) return -1;

    // Find the character element at the touch point
    const element = document.elementFromPoint(x, y);
    if (!element || !container.contains(element)) return -1;

    // Check if it's one of our character spans
    const charIndex = charactersRef.current.findIndex(span => span === element || span.contains(element));
    return charIndex;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent, charIndex: number) => {
    e.preventDefault();
    isDraggingRef.current = false;
    
    // Start long press detection
    longPressTimeoutRef.current = setTimeout(() => {
      if (!isDraggingRef.current) {
        setSelection({
          startIndex: charIndex,
          endIndex: charIndex,
          isSelecting: true,
        });
        
        // Add haptic feedback if available
        if ('vibrate' in navigator) {
          navigator.vibrate([50, 50, 50]); // Triple tap pattern
        }
      }
    }, 250); // 250ms long press - shorter for better responsiveness
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    
    // Clear long press timeout since user is dragging
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }

    if (!selection.isSelecting) return;

    const touch = e.touches[0];
    if (!touch) return;

    const charIndex = getCharacterIndexFromPoint(touch.clientX, touch.clientY);
    if (charIndex >= 0) {
      setSelection(prev => ({
        ...prev,
        endIndex: charIndex,
      }));
    }
  }, [selection.isSelecting, getCharacterIndexFromPoint]);

  const handleTouchEnd = useCallback(async (e: React.TouchEvent) => {
    e.preventDefault();
    
    // Clear long press timeout
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }

    if (!selection.isSelecting || selection.startIndex < 0 || selection.endIndex < 0) {
      setSelection({ startIndex: -1, endIndex: -1, isSelecting: false });
      return;
    }

    const startIndex = Math.min(selection.startIndex, selection.endIndex);
    const endIndex = Math.max(selection.startIndex, selection.endIndex);
    const selectedText = text.slice(startIndex, endIndex + 1);

    if (selectedText.trim().length === 0) {
      setSelection({ startIndex: -1, endIndex: -1, isSelecting: false });
      return;
    }

    // Get touch position for popup placement
    const touch = e.changedTouches[0];
    const rawX = touch?.clientX ?? 0;
    const rawY = touch?.clientY ?? 0;
    const { x: popupX, y: popupY } = calculatePopupPosition(rawX, rawY);

    // Analyze and translate the selected text
    setIsTranslating(true);
    try {
      // Run morphological analysis and translation in parallel
      const [analysis, translationResult] = await Promise.all([
        analyzeJapaneseText(selectedText),
        (async () => {
          // Create a unique ID for this selection to avoid caching conflicts
          const selectionId = `selection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          const { translations } = await translateSentences({
            sentences: [{ id: selectionId, text: selectedText }],
            direction,
            documentId,
            batchSize: 1,
            maxCharactersPerBatch: selectedText.length,
            instruction: 'Translate this text selection naturally and concisely.',
          });

          return translations[selectionId] || 'Translation not available';
        })()
      ]);
      
      setPopup({
        text: selectedText,
        translation: translationResult,
        analysis,
        x: popupX,
        y: popupY,
      });
    } catch (error) {
      console.error('Translation/Analysis failed:', error);
      
      // Fallback analysis for error case
      const fallbackAnalysis: DetailedAnalysis = {
        original: [{
          surface: selectedText,
          baseForm: selectedText,
          partOfSpeech: 'Unknown',
          features: [],
        }],
        wordType: 'Unknown',
        furiganaSegments: selectedText.split('').map(char => ({
          text: char,
          reading: undefined,
          isKanji: /[一-龯]/.test(char),
        })),
      };
      
      setPopup({
        text: selectedText,
        translation: 'Translation failed',
        analysis: fallbackAnalysis,
        x: popupX,
        y: popupY,
      });
    } finally {
      setIsTranslating(false);
    }

    // Clear selection
    setSelection({ startIndex: -1, endIndex: -1, isSelecting: false });
  }, [selection, text, direction, documentId]);

  const closePopup = useCallback(() => {
    setPopup(null);
  }, []);

  // Popup dragging handlers
  const handlePopupMouseDown = useCallback((e: React.MouseEvent) => {
    if (!popup) return;
    
    // Only allow dragging from the header area (not buttons or other interactive elements)
    const target = e.target as HTMLElement;
    const isHeaderArea = target.closest('.popup-header') || target.classList.contains('popup-header');
    
    if (isHeaderArea) {
      e.preventDefault();
      e.stopPropagation();
      
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setPopupDragging(true);
    }
  }, [popup]);

  const handlePopupMouseMove = useCallback((e: MouseEvent) => {
    if (!popupDragging || !popup) return;
    
    e.preventDefault();
    
    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;
    
    // Keep popup within viewport bounds
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const popupWidth = 400; // approximate popup width
    const popupHeight = 300; // approximate popup height
    
    const constrainedX = Math.max(10, Math.min(newX, viewportWidth - popupWidth - 10));
    const constrainedY = Math.max(10, Math.min(newY, viewportHeight - popupHeight - 10));
    
    setPopup({
      ...popup,
      x: constrainedX,
      y: constrainedY,
    });
  }, [popupDragging, popup, dragOffset]);

  const handlePopupMouseUp = useCallback(() => {
    setPopupDragging(false);
  }, []);

  // Global mouse event listeners for popup dragging
  useEffect(() => {
    if (popupDragging) {
      document.addEventListener('mousemove', handlePopupMouseMove);
      document.addEventListener('mouseup', handlePopupMouseUp);
      
      return () => {
        document.removeEventListener('mousemove', handlePopupMouseMove);
        document.removeEventListener('mouseup', handlePopupMouseUp);
      };
    }
  }, [popupDragging, handlePopupMouseMove, handlePopupMouseUp]);

  // Handle TTS audio playback with smart caching
  const playAudio = useCallback(async (text: string) => {
    if (isPlayingAudio) return;
    
    setIsPlayingAudio(true);
    try {
      const trimmedText = text.trim();
      
      // Check cache first 🚀
      const cachedTTS = smartCache.getTTS(trimmedText, 'ja');
      if (cachedTTS) {
        console.log('🎵 Playing cached TTS');
        const audio = new Audio(cachedTTS.audioUrl);
        audio.onended = () => setIsPlayingAudio(false);
        audio.onerror = () => setIsPlayingAudio(false);
        await audio.play();
        return;
      }

      // Cache miss - generate new TTS
      console.log('🔄 Generating new TTS (cache miss)');
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: trimmedText, 
          lang: 'ja'
        }),
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`);
      }

      const { result, url } = await response.json();
      
      // Cache the result for future use
      smartCache.setTTS(trimmedText, url, result.audioId, result.durationMs, 'ja');
      
      // Create and play audio
      const audio = new Audio(url);
      audio.onended = () => setIsPlayingAudio(false);
      audio.onerror = () => setIsPlayingAudio(false);
      
      await audio.play();
    } catch (error) {
      console.error('TTS playback failed:', error);
      setIsPlayingAudio(false);
    }
  }, [isPlayingAudio]);

  // Handle mouse events for desktop testing
  const handleMouseDown = useCallback((e: React.MouseEvent, charIndex: number) => {
    e.preventDefault();
    setSelection({
      startIndex: charIndex,
      endIndex: charIndex,
      isSelecting: true,
    });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!selection.isSelecting) return;
    
    const charIndex = getCharacterIndexFromPoint(e.clientX, e.clientY);
    if (charIndex >= 0) {
      setSelection(prev => ({
        ...prev,
        endIndex: charIndex,
      }));
    }
  }, [selection.isSelecting, getCharacterIndexFromPoint]);

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (!selection.isSelecting || selection.startIndex < 0 || selection.endIndex < 0) {
      setSelection({ startIndex: -1, endIndex: -1, isSelecting: false });
      return;
    }

    const startIndex = Math.min(selection.startIndex, selection.endIndex);
    const endIndex = Math.max(selection.startIndex, selection.endIndex);
    const selectedText = text.slice(startIndex, endIndex + 1);

    if (selectedText.trim().length === 0) {
      setSelection({ startIndex: -1, endIndex: -1, isSelecting: false });
      return;
    }

    setIsTranslating(true);
    try {
      // Run morphological analysis and smart cached translation in parallel
      const [analysis, translationResult] = await Promise.all([
        analyzeJapaneseText(selectedText),
        (async () => {
          // Check cache first 🚀
          const cachedTranslation = smartCache.getTranslation(selectedText, direction, documentId);
          if (cachedTranslation) {
            console.log('💾 Using cached translation');
            return cachedTranslation;
          }

          // Cache miss - get fresh translation
          console.log('🔄 Getting fresh translation (cache miss)');
          const selectionId = `selection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          const { translations } = await translateSentences({
            sentences: [{ id: selectionId, text: selectedText }],
            direction,
            documentId,
            batchSize: 1,
            maxCharactersPerBatch: selectedText.length,
            instruction: 'Translate this text selection naturally and concisely.',
          });

          const translation = translations[selectionId] || 'Translation not available';
          
          // Cache the result for future use
          if (translation !== 'Translation not available') {
            smartCache.setTranslation(selectedText, translation, direction, documentId);
          }

          return translation;
        })()
      ]);
      
      const { x: popupX, y: popupY } = calculatePopupPosition(e.clientX, e.clientY);
      
      setPopup({
        text: selectedText,
        translation: translationResult,
        analysis,
        x: popupX,
        y: popupY,
      });
    } catch (error) {
      console.error('Translation/Analysis failed:', error);
      
      // Fallback analysis for error case
      const fallbackAnalysis: DetailedAnalysis = {
        original: [{
          surface: selectedText,
          baseForm: selectedText,
          partOfSpeech: 'Unknown',
          features: [],
        }],
        wordType: 'Unknown',
        furiganaSegments: selectedText.split('').map(char => ({
          text: char,
          reading: undefined,
          isKanji: /[一-龯]/.test(char),
        })),
      };
      
      const { x: popupX, y: popupY } = calculatePopupPosition(e.clientX, e.clientY);
      
      setPopup({
        text: selectedText,
        translation: 'Translation failed',
        analysis: fallbackAnalysis,
        x: popupX,
        y: popupY,
      });
    } finally {
      setIsTranslating(false);
    }

    setSelection({ startIndex: -1, endIndex: -1, isSelecting: false });
  }, [selection, text, direction, documentId]);

  const getCharacterClass = useCallback((index: number) => {
    const startIndex = Math.min(selection.startIndex, selection.endIndex);
    const endIndex = Math.max(selection.startIndex, selection.endIndex);
    
    if (selection.isSelecting && index >= startIndex && index <= endIndex) {
      return 'bg-blue-200/80 dark:bg-blue-600/60 backdrop-blur-sm transform -translate-y-1 scale-105 shadow-sm transition-all duration-200 ease-out rounded-sm';
    }
    
    return 'transition-all duration-200 ease-out hover:bg-neutral-100/50 dark:hover:bg-neutral-800/50 rounded-sm';
  }, [selection]);

  const characters = text.split('');

  return (
    <>
      <div
        ref={containerRef}
        className={`select-none touch-none ${className}`}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{ userSelect: 'none' }}
      >
        {characters.map((char, index) => (
          <span
            key={index}
            ref={el => {
              if (el) charactersRef.current[index] = el;
            }}
            className={`inline-block cursor-pointer ${getCharacterClass(index)}`}
            onTouchStart={(e) => handleTouchStart(e, index)}
            onMouseDown={(e) => handleMouseDown(e, index)}
          >
            {char}
          </span>
        ))}
      </div>

      {/* Detailed Translation Popup */}
      {popup && (
        <div
          className={`fixed z-50 pointer-events-none ${popupDragging ? 'cursor-grabbing' : ''}`}
          style={{
            left: `${popup.x}px`,
            top: `${popup.y}px`,
          }}
        >
          <div 
            className={`pointer-events-auto bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl max-w-sm backdrop-blur-sm bg-white/95 dark:bg-neutral-900/95 ${popupDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            onMouseDown={handlePopupMouseDown}
          >
            {/* Draggable Header */}
            <div className="popup-header flex justify-between items-center p-3 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 rounded-t-lg cursor-grab">
              <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400 uppercase tracking-wide">
                Translation
              </div>
              <button
                onClick={closePopup}
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                aria-label="Close translation popup"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            
            {/* Popup Content */}
            <div className="p-4">{/* Section 1: Base Form */}
            {popup.analysis.baseWord && (
              <div className="mb-4 pb-4 border-b border-neutral-200 dark:border-neutral-700">
                <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">
                  Base Form
                </div>
                                <div className="text-xl font-medium text-neutral-900 dark:text-neutral-100 mb-1">
                  <FuriganaText 
                    segments={generateFuriganaSegments(popup.analysis.baseWord.surface, popup.analysis.baseWord.reading)}
                    className="pb-2"
                  />
                </div>
              </div>
            )}

            {/* Section 2: Current Form */}
            <div className="mb-4 pb-4 border-b border-neutral-200 dark:border-neutral-700">
              <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">
                Selected Form
              </div>
              <div className="text-xl font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                <FuriganaText 
                  segments={popup.analysis.furiganaSegments}
                  className="pb-2"
                />
              </div>
              {popup.analysis.conjugationInfo && (
                <div className="text-sm text-blue-600 dark:text-blue-400 italic">
                  {popup.analysis.conjugationInfo}
                </div>
              )}
            </div>

            {/* Audio Playback Button */}
            <div className="mb-4 pb-4 border-b border-neutral-200 dark:border-neutral-700">
              <button
                onClick={() => playAudio(popup.text)}
                disabled={isPlayingAudio}
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Play pronunciation"
              >
                {isPlayingAudio ? (
                  <>
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">Playing...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.824L4.168 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.168l4.215-3.824zm2.617 2.062a1 1 0 011 1v7.724a1 1 0 01-2 0V6.138z" clipRule="evenodd" />
                      <path fillRule="evenodd" d="M12.293 7.293a1 1 0 011.414 0A6.5 6.5 0 0116 12a6.5 6.5 0 01-2.293 4.707 1 1 0 01-1.414-1.414A4.5 4.5 0 0014 12a4.5 4.5 0 00-1.707-3.293 1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">Play Audio</span>
                  </>
                )}
              </button>
            </div>

            {/* Section 3: Translation & Word Type */}
            <div className="mb-4">
              <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">
                Translation & Type
              </div>
              <div className="text-base text-neutral-700 dark:text-neutral-300 mb-2 leading-relaxed">
                {popup.translation}
              </div>
              <div className="inline-block px-2 py-1 bg-neutral-100 dark:bg-neutral-800 rounded text-xs font-medium text-neutral-600 dark:text-neutral-400">
                {popup.analysis.wordType}
              </div>
            </div>

            {/* Close Button */}
            <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-700">
              <button
                onClick={closePopup}
                className="w-full text-sm bg-primary text-white px-4 py-2 rounded-md hover:bg-primary/90 active:scale-95 transition-all duration-150 font-medium shadow-sm"
              >
                Close
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading indicator */}
      {isTranslating && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 backdrop-blur-sm pointer-events-none">
          <div className="bg-white dark:bg-neutral-900 rounded-lg px-6 py-3 shadow-xl border border-neutral-200 dark:border-neutral-700">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
              <div className="text-sm text-neutral-600 dark:text-neutral-400 font-medium">
                Translating...
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}