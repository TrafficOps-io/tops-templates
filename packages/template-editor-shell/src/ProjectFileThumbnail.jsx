import { useEffect, useState } from 'react';
import { FileCode2, ImageIcon } from 'lucide-react';
import { createProjectFilePreview, projectFileImageMime } from './project-file-preview.js';

export default function ProjectFileThumbnail({ path, value, className = '' }) {
  const [preview, setPreview] = useState(null), [failedUrl, setFailedUrl] = useState(null);
  useEffect(() => {
    const resource = createProjectFilePreview(path, value);
    setPreview(resource ? { path, value, url: resource.url } : null);
    return () => resource?.dispose();
  }, [path, value]);
  const src = preview?.path === path && preview?.value === value && preview.url !== failedUrl ? preview.url : null;
  const Icon = projectFileImageMime(path) || /\.svg$/i.test(path) ? ImageIcon : FileCode2;
  return <span className={`project-file-thumbnail ${className}`} aria-hidden="true">
    {src ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedUrl(src)} /> : <Icon size={18} />}
  </span>;
}
