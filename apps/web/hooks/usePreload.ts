'use client';

import { useEffect, useRef } from 'react';
import { preloadService, type DocumentPage } from '@/lib/preload-service';
import type { TranslationDirection } from '@/providers/translation/base';

interface UsePreloadOptions {
  documentId: string;
  currentPageIndex: number;
  pages: DocumentPage[];
  direction: TranslationDirection;
  enabled?: boolean;
}

export function usePreload({
  documentId,
  currentPageIndex,
  pages,
  direction,
  enabled = true,
}: UsePreloadOptions) {
  const lastPageIndexRef = useRef<number>(-1);
  const initializedRef = useRef<boolean>(false);

  // Initialize preloading when document first loads
  useEffect(() => {
    if (!enabled || initializedRef.current || pages.length === 0) {
      return;
    }

    console.log('🚀 Initializing preload service for document:', documentId);
    
    // Start preloading current + next pages
    preloadService.preloadDocument(documentId, currentPageIndex, pages, direction);
    initializedRef.current = true;
    lastPageIndexRef.current = currentPageIndex;

  }, [documentId, currentPageIndex, pages, direction, enabled]);

  // Handle page advances
  useEffect(() => {
    if (!enabled || !initializedRef.current) {
      return;
    }

    // User advanced to a new page
    if (currentPageIndex !== lastPageIndexRef.current && currentPageIndex >= 0) {
      console.log(`📖 Page advanced: ${lastPageIndexRef.current} → ${currentPageIndex}`);
      
      preloadService.advancePage(documentId, currentPageIndex, pages, direction);
      lastPageIndexRef.current = currentPageIndex;
    }

  }, [currentPageIndex, documentId, pages, direction, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('🧹 Cleaning up preload service');
      initializedRef.current = false;
    };
  }, []);

  // Return stats for debugging
  return {
    stats: preloadService.getStats(),
    isEnabled: enabled,
    initialized: initializedRef.current,
  };
}