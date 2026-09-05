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

      // 1. Check HTML clipboard content for animated GIF / WebP image tags FIRST!
      // In Chrome/Edge/Firefox, when a user right-clicks an animated GIF/WebP on the web
      // (Tenor, Giphy, Discord, etc.) and clicks "Copy Image", the browser populates
      // items[0] with a FLATTENED single-frame static PNG, while text/html contains the
      // actual animated image URL! Prioritizing animated <img> URLs preserves full animation.
      const html = e.clipboardData?.getData('text/html');
      if (html) {
        const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match && match[1]) {
          const src = match[1].trim();
          const isAnimSrc = /\.(gif|webp)($|[?#])/i.test(src) || src.startsWith('data:image/gif') || src.startsWith('data:image/webp');
          if (isAnimSrc) {
            if (src.startsWith('data:image/')) {
              e.preventDefault();
              console.log(`[NexusVR:Clipboard] 🎬 Pasted animated HTML <img> data URI. Converting via fetch...`);
              fetch(src)
                .then((res) => res.blob())
                .then((blob) => {
                  const ext = (blob.type ? blob.type.split('/')[1] : 'gif') || 'gif';
                  const file = new File([blob], `pasted_animated_${Date.now()}.${ext}`, { type: blob.type || 'image/gif' });
                  setImportInitialFile(file);
                  setShowImportDialog(true);
                })
                .catch((err) => console.warn('[NexusVR:Clipboard] Failed to parse animated data URI:', err));
              return;
            } else if (src.startsWith('http://') || src.startsWith('https://')) {
              e.preventDefault();
              console.log(`[NexusVR:Clipboard] 🎬 Pasted animated HTML <img> URL: "${src}"`);
              setImportInitialFile(null);
              setImportInitialUrl?.(src);
              setShowImportDialog(true);
              return;
            }
          }
        }
      }

      // 2. Check clipboardData.items for copied image / file data items
      if (e.clipboardData?.items && e.clipboardData.items.length > 0) {
        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];
          if (item.kind === 'file' || item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              // Read arrayBuffer immediately so the bytes reside safely in JS heap memory
              // before OS clipboard handles are released or invalidated by subsequent events
              file.arrayBuffer().then((buffer) => {
                const extFromName = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
                const extFromType = file.type ? file.type.split('/')[1] : undefined;
                const ext = (extFromName && extFromName !== 'blob' && extFromName !== 'image') ? extFromName : (extFromType || 'png');
                const mimeType = file.type || (ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`);
                const hasExt = /\.[a-zA-Z0-9]+$/.test(file.name);
                const fileName = (!hasExt || file.name === 'blob' || file.name === 'image')
                  ? `pasted_image_${Date.now()}.${ext}`
                  : file.name;
                const finalFile = new File([buffer], fileName, { type: mimeType });
                console.log(`[NexusVR:Clipboard] 📋 Pasted image item buffered: "${finalFile.name}" (${(finalFile.size / 1024).toFixed(1)} KB, type: ${finalFile.type})`);
                setImportInitialFile(finalFile);
                setShowImportDialog(true);
              }).catch((err) => {
                console.warn('[NexusVR:Clipboard] ⚠️ Failed to buffer pasted image:', err);
              });
              return;
            }
          }
        }
      }

      // 3. Check clipboardData.files (e.g. files copied from file managers)
      if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        e.preventDefault();
        file.arrayBuffer().then((buffer) => {
          const extFromName = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : undefined;
          const extFromType = file.type ? file.type.split('/')[1] : undefined;
          const ext = (extFromName && extFromName !== 'blob' && extFromName !== 'image') ? extFromName : (extFromType || 'png');
          const mimeType = file.type || (ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`);
          const hasExt = /\.[a-zA-Z0-9]+$/.test(file.name);
          const fileName = (!hasExt || file.name === 'blob' || file.name === 'image')
            ? `pasted_image_${Date.now()}.${ext}`
            : file.name;
          const finalFile = new File([buffer], fileName, { type: mimeType });
          console.log(`[NexusVR:Clipboard] 📋 Pasted file buffered: "${finalFile.name}" (${(finalFile.size / 1024).toFixed(1)} KB, type: ${finalFile.type})`);
          setImportInitialFile(finalFile);
          setShowImportDialog(true);
        }).catch((err) => {
          console.warn('[NexusVR:Clipboard] ⚠️ Failed to buffer pasted file:', err);
        });
        return;
      }

      // 4. Check clipboardData text (URLs or base64 data URIs)
      if (e.clipboardData) {
        const text = e.clipboardData.getData('text');
        if (text) {
          const trimmed = text.trim();
          if (trimmed.startsWith('data:image/')) {
            e.preventDefault();
            console.log(`[NexusVR:Clipboard] 📋 Pasted data:image URI (${(trimmed.length / 1024).toFixed(1)} KB). Converting via fetch...`);
            fetch(trimmed)
              .then((res) => res.blob())
              .then((blob) => {
                const ext = (blob.type ? blob.type.split('/')[1] : 'png') || 'png';
                const file = new File([blob], `pasted_image_${Date.now()}.${ext}`, { type: blob.type || 'image/png' });
                console.log(`[NexusVR:Clipboard] 📋 Data URI converted to File: "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`);
                setImportInitialFile(file);
                setShowImportDialog(true);
              })
              .catch((err) => {
                console.warn('[NexusVR:Clipboard] ⚠️ Failed to parse pasted data URI:', err);
              });
            return;
          }

          if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
            e.preventDefault();
            console.log(`[NexusVR:Clipboard] 📋 Pasted media URL: "${trimmed}"`);
            setImportInitialFile(null);
            setImportInitialUrl?.(trimmed);
            setShowImportDialog(true);
            return;
          }
        }

        // 5. Fallback HTML clipboard content for standard <img> tags
        if (html) {
          const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
          if (match && match[1]) {
            const src = match[1].trim();
            if (src.startsWith('data:image/')) {
              e.preventDefault();
              fetch(src)
                .then((res) => res.blob())
                .then((blob) => {
                  const ext = (blob.type ? blob.type.split('/')[1] : 'png') || 'png';
                  const file = new File([blob], `pasted_image_${Date.now()}.${ext}`, { type: blob.type || 'image/png' });
                  console.log(`[NexusVR:Clipboard] 📋 Pasted HTML <img> data URI converted to File: "${file.name}"`);
                  setImportInitialFile(file);
                  setShowImportDialog(true);
                })
                .catch(() => {});
              return;
            } else if (src.startsWith('http://') || src.startsWith('https://')) {
              e.preventDefault();
              console.log(`[NexusVR:Clipboard] 📋 Pasted HTML <img> URL: "${src}"`);
              setImportInitialFile(null);
              setImportInitialUrl?.(src);
              setShowImportDialog(true);
              return;
            }
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
