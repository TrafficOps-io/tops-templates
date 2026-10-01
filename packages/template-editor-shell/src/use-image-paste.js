import { useEffect } from 'react';

export function clipboardImageFiles(clipboardData) {
  const images = Array.from(clipboardData?.items || [])
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile()).filter(Boolean);
  // items and files usually describe the same images. Use files only as a
  // fallback so a single pasted screenshot cannot become two references.
  return images.length ? images : Array.from(clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
}

export function useImagePaste(promptRef, add, disabled) {
  function onPaste(event) {
    if (disabled || event.defaultPrevented) return;
    const images = clipboardImageFiles(event.clipboardData);
    if (!images.length) return;
    event.preventDefault();
    void add(images);
  }
  useEffect(() => {
    const prompt = promptRef?.current;
    if (!prompt) return;
    prompt.addEventListener('paste', onPaste);
    return () => prompt.removeEventListener('paste', onPaste);
  });
  return onPaste;
}
