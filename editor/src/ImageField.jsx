import { useEffect, useRef, useState } from 'react';
import { Crop, FileImage, LoaderCircle, Sparkles, UploadCloud } from 'lucide-react';
import ImageCropDialog from './ImageCropDialog.jsx';
import { imageMime } from './image-editing.js';
import { loadOpenRouterSettings } from './openrouter-settings.js';
import { generateImageWithOpenRouter } from './openrouter-images.js';
export default function ImageField({ id, field, value, onChange, projectImages, onImageUpload, files, aiEnabled, onSettings }) {
  const [editing, setEditing] = useState(null), [error, setError] = useState(''), [preview, setPreview] = useState('');
  const [aiOpen, setAiOpen] = useState(false), [prompt, setPrompt] = useState(''), [working, setWorking] = useState(false), [elapsed, setElapsed] = useState(0);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!working) return; const start = Date.now(); const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(timer);
  }, [working]);
  useEffect(() => {
    if (!files || !Object.hasOwn(files, value)) { setPreview(''); return; }
    const url = URL.createObjectURL(new Blob([files[value]], { type: imageMime(value) })); setPreview(url); return () => URL.revokeObjectURL(url);
  }, [files, value]);
  function choose(file) { if (!file || working) return; setError(''); setEditing(file); }
  async function generate() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; const timer = setTimeout(() => controller.abort(), 180000);
    setWorking(true); setError(''); setElapsed(0);
    try { const settings = await loadOpenRouterSettings(); const file = await generateImageWithOpenRouter({ ...settings, prompt, field, signal: controller.signal }); if (!controller.signal.aborted) setEditing(file); }
    catch (error) { if (!controller.signal.aborted) setError(error.message); else setError('Image generation cancelled or timed out.'); }
    finally { clearTimeout(timer); request.current = null; setWorking(false); }
  }
  return <><input id={id} className="input w-full" required={field.required} list={`${id}-images`} value={value || ''} onChange={event => onChange(event.target.value)} placeholder="images/photo.png" /><datalist id={`${id}-images`}>{projectImages.map(path => <option key={path} value={path} />)}</datalist>{preview && <div className="image-field-preview"><img src={preview} alt={field.label || 'Selected image'} /><button className="btn btn-outline btn-xs" disabled={working} onClick={() => choose(new File([files[value]], value.split('/').pop(), { type: imageMime(value) }))}><Crop size={13} /> Crop & resize</button></div>}<label className="image-drop-zone" htmlFor={`${id}-upload`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); choose(event.dataTransfer.files?.[0]); }}><UploadCloud size={17} /><span>Drop an image or <strong>choose a file</strong></span><small>Crop & resize before adding</small></label><input id={`${id}-upload`} hidden type="file" accept="image/*,.svg" disabled={working} onChange={event => { choose(event.target.files?.[0]); event.target.value = ''; }} />{aiEnabled && <><button className="btn btn-ghost btn-xs image-ai-button" aria-expanded={aiOpen} onClick={() => setAiOpen(!aiOpen)}><Sparkles size={13} /> Generate image with AI</button>{aiOpen && <div className="image-ai-form"><textarea aria-label={`Image prompt for ${field.label || field.name}`} className="textarea w-full" rows={3} maxLength={6000} value={prompt} disabled={working} onChange={event => setPrompt(event.target.value)} placeholder="Describe the image, composition, lighting and style…" /><p className="field-help">Your prompt and field description go to OpenRouter. Uses the image model in <button className="text-link" onClick={onSettings}>Settings</button> and your paid account.</p><div className="ai-actions"><button className="btn btn-primary btn-sm" disabled={working || !prompt.trim()} onClick={generate}>{working ? <LoaderCircle size={14} className="spin" /> : <FileImage size={14} />}{working ? `Generating · ${elapsed}s` : 'Generate image'}</button>{working && <button className="btn btn-ghost btn-sm" onClick={() => request.current?.abort()}>Cancel</button>}</div></div>}</>}{error && <p role="alert" className="inline-error">{error}</p>}{editing && <ImageCropDialog file={editing} field={field} onClose={() => setEditing(null)} onSave={async file => { const path = await onImageUpload(file); if (!path) throw new Error('The image could not be saved. Check project access and size.'); onChange(path); }} />}</>;
}
