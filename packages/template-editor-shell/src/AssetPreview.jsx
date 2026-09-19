import { useStudioText } from './studio-i18n.js';
import { useEffect, useState } from 'react';
import { FileImage } from 'lucide-react';
import { imageMime } from './image-editing.js';
import { byteSize } from './project.js';

export default function AssetPreview({ path, value, onEditSource }) {
  const t = useStudioText();
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false), [dimensions, setDimensions] = useState(null);
  const mime = imageMime(path), isImage = mime.startsWith('image/');
  useEffect(() => {
    setFailed(false); setDimensions(null);
    if (!isImage || value == null) { setUrl(''); return; }
    const source = URL.createObjectURL(new Blob([value], { type: mime }));
    setUrl(source); return () => URL.revokeObjectURL(source);
  }, [path, value, mime, isImage]);
  return <div className="asset-preview">
    {isImage && url && !failed ? <div className="asset-image-stage"><img src={url} alt={path} onError={() => setFailed(true)} onLoad={event => setDimensions([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])} /></div> : <FileImage size={36} />}
    <div className="asset-details">{onEditSource && <button type="button" className="btn btn-outline btn-sm" onClick={onEditSource}>{t("Edit source")}</button>}<h3>{isImage ? failed ? t("Image preview unavailable") : t("Image preview") : t("Asset included")}</h3><code>{path}</code><span>{dimensions && `${dimensions[0]} × ${dimensions[1]} px · `}{Math.ceil(byteSize(value || '') / 1024)} KiB</span><p>{failed ? t("This image could not be decoded by your browser. The original file is preserved.") : t("Reference this file by its relative path. It is included in your ZIP.")}</p></div>
  </div>;
}
