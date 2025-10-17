'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { ACTIVE_TRANSLATION_PROVIDER } from '@/lib/config';
import { translateSentences } from '@/utils/translateSentences';
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
  x: number;
  y: number;
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
    const popupX = touch?.clientX ?? 0;
    const popupY = touch?.clientY ?? 0;

    // Translate the selected text
    setIsTranslating(true);
    try {
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

      const translation = translations[selectionId] || 'Translation not available';
      
      setPopup({
        text: selectedText,
        translation,
        x: popupX,
        y: popupY,
      });
    } catch (error) {
      console.error('Translation failed:', error);
      setPopup({
        text: selectedText,
        translation: 'Translation failed',
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

      const translation = translations[selectionId] || 'Translation not available';
      
      setPopup({
        text: selectedText,
        translation,
        x: e.clientX,
        y: e.clientY,
      });
    } catch (error) {
      console.error('Translation failed:', error);
      setPopup({
        text: selectedText,
        translation: 'Translation failed',
        x: e.clientX,
        y: e.clientY,
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

      {/* Translation Popup */}
      {popup && (
        <div 
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${Math.min(popup.x, (typeof window !== 'undefined' ? window.innerWidth : 800) - 320)}px`,
            top: `${Math.max(popup.y - 100, 10)}px`,
          }}
        >
          <div className="pointer-events-auto bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl p-4 max-w-xs backdrop-blur-sm bg-white/95 dark:bg-neutral-900/95">
            <div className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2 leading-tight">
              "{popup.text}"
            </div>
            <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-4 leading-relaxed">
              {popup.translation}
            </div>
            <button
              onClick={closePopup}
              className="text-xs bg-primary text-white px-4 py-2 rounded-md hover:bg-primary/90 active:scale-95 transition-all duration-150 font-medium shadow-sm"
            >
              Close
            </button>
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