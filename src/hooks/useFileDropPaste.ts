import { useEffect } from 'react';

export interface UseFileDropPasteOptions {
  plainPasteModeRef: React.MutableRefObject<boolean>;
  setImportInitialFile: (file: File | null) => void;
  setImportInitialUrl?: (url: string) => void;
  setShowImportDialog: (show: boolean) => void;
}

/**
 * Hook for global Drag-and-Drop and Clipboard Paste (Ctrl+V) event handling.
 * Ingests dropped or pasted 3D models/media files/URLs/copied clipboard images and triggers the import dialog.
 */
export function useFileDropPaste({
  plainPasteModeRef,
  setImportInitialFile,
  setImportInitialUrl,
  setShowImportDialog,
}: UseFileDropPasteOptions): void {
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        setImportInitialFile(file);
        setImportInitialUrl?.('');
        setShowImportDialog(true);
        return;
      }
      const uri = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
      if (uri) {
        const trimmed = uri.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
          setImportInitialFile(null);
          setImportInitialUrl?.(trimmed);
          setShowImportDialog(true);
        }
      }
    };

    const handlePaste = (e: ClipboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      // Inputs always hand off to the browser's default paste behavior.
      if (['INPUT', 'TEXTAREA'].includes(tag)) {
        if (plainPasteModeRef.current) plainPasteModeRef.current = false;
        return;
      }

      // Ctrl+Shift+V (no input focus): user explicitly wants plain text -
      // suppress the asset-import path.
      if (plainPasteModeRef.current) {
        plainPasteModeRef.current = false;
        e.preventDefault();
        return;
      }

      // 1. Check clipboardData.items for copied image / file data items (e.g. screenshots, copied image bitmaps)
      if (e.clipboardData?.items && e.clipboardData.items.length > 0) {
        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];
          if (item.kind === 'file' || item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              let finalFile = file;
              const hasExt = /\.[a-zA-Z0-9]+$/.test(file.name);
              if (!hasExt || file.name === 'blob' || file.name === 'image') {
                const ext = file.type ? file.type.split('/')[1] || 'png' : 'png';
                finalFile = new File([file], `pasted_image_${Date.now()}.${ext}`, { type: file.type || 'image/png' });
              }
              e.preventDefault();
              setImportInitialFile(finalFile);
              setShowImportDialog(true);
              return;
            }
          }
        }
      }

      // 2. Check clipboardData.files (e.g. files copied from file managers)
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        let finalFile = file;
        const hasExt = /\.[a-zA-Z0-9]+$/.test(file.name);
        if (!hasExt || file.name === 'blob' || file.name === 'image') {
          const ext = file.type ? file.type.split('/')[1] || 'png' : 'png';
          finalFile = new File([file], `pasted_image_${Date.now()}.${ext}`, { type: file.type || 'image/png' });
        }
        e.preventDefault();
        setImportInitialFile(finalFile);
        setShowImportDialog(true);
        return;
      }

      // 3. Check clipboardData text (URLs or base64 data URIs)
      if (e.clipboardData) {
        const text = e.clipboardData.getData('text');
        if (text) {
          const trimmed = text.trim();
          if (trimmed.startsWith('data:image/')) {
            try {
              const [header, base64Data] = trimmed.split(',');
              const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
              const ext = mime.split('/')[1] || 'png';
              const binary = atob(base64Data);
              const array = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) {
                array[i] = binary.charCodeAt(i);
              }
              const blob = new Blob([array], { type: mime });
              const file = new File([blob], `pasted_image_${Date.now()}.${ext}`, { type: mime });
              e.preventDefault();
              setImportInitialFile(file);
              setShowImportDialog(true);
              return;
            } catch {
              // fallback to standard URL import below
            }
          }

          if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
            e.preventDefault();
            setImportInitialFile(null);
            setImportInitialUrl?.(trimmed);
            setShowImportDialog(true);
          }
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('paste', handlePaste);
    };
  }, [plainPasteModeRef, setImportInitialFile, setImportInitialUrl, setShowImportDialog]);
}
