import { useState } from 'react';
import { FileImage, Plus, Trash2, UploadCloud } from 'lucide-react';

function defaults(fields = []) {
  return Object.fromEntries(fields.map(field => [field.name, field.default ?? (field.type === 'group' ? defaults(field.fields) : field.type === 'repeater' ? [] : field.type === 'checkbox' ? false : '')]));
}

function ImageField({ id, field, value, onChange, projectImages, onImageUpload }) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const upload = async file => {
    if (!file) return;
    setUploading(true);
    try {
      const path = await onImageUpload(file);
      if (path) { onChange(path); setOptionsOpen(false); }
    } finally { setUploading(false); }
  };
  return <>
    <div className="image-path-picker"><input id={id} required={field.required} aria-describedby={`${id}-help`} aria-autocomplete="list" aria-expanded={optionsOpen && projectImages.length > 0} className="input input-bordered w-full" type="text" value={value ?? ''} placeholder="images/photo.jpg" autoComplete="off" onFocus={() => setOptionsOpen(true)} onBlur={() => setOptionsOpen(false)} onChange={event => { onChange(event.target.value); setOptionsOpen(true); }} />
      {optionsOpen && projectImages.length > 0 && <div className="image-path-options" role="listbox" aria-label="Project images">{projectImages.map(path => <button type="button" role="option" aria-selected={path === value} key={path} onMouseDown={event => { event.preventDefault(); onChange(path); }}><FileImage size={14} /><span>{path}</span></button>)}</div>}
    </div>
    <label className={`image-drop-zone ${uploading ? 'uploading' : ''}`} htmlFor={`${id}-upload`} onDragOver={event => { event.preventDefault(); event.currentTarget.classList.add('dragging'); }} onDragLeave={event => event.currentTarget.classList.remove('dragging')} onDrop={event => { event.preventDefault(); event.currentTarget.classList.remove('dragging'); upload(event.dataTransfer.files?.[0]); }}><UploadCloud size={17} /><span>{uploading ? 'Adding image…' : <>Drop an image here or <strong>choose a file</strong></>}</span><small>It will be added to images/</small></label>
    <input id={`${id}-upload`} hidden type="file" accept="image/*,.svg" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; upload(file); }} />
  </>;
}

function Field({ field, value, onChange, prefix = '', projectImages, onImageUpload }) {
  const id = `setting-${prefix}${field.name}`;
  const children = field.fields || [];
  if (field.type === 'group') {
    return <fieldset className="field-group"><legend>{field.label || field.name}</legend>{children.map(child => <Field key={child.name} field={child} value={value?.[child.name]} prefix={`${prefix}${field.name}-`} projectImages={projectImages} onImageUpload={onImageUpload} onChange={next => onChange({ ...(value || {}), [child.name]: next })} />)}</fieldset>;
  }
  if (field.type === 'repeater') {
    const items = Array.isArray(value) ? value : [];
    return <fieldset className="field-group"><legend>{field.label || field.name} <span className="count">{items.length}</span></legend>
      {field.help && <p className="field-help">{field.help}</p>}
      {items.map((item, index) => <div className="repeater-item" key={index}><div className="repeater-heading"><span>Item {index + 1}</span><button type="button" className="btn btn-ghost btn-xs" aria-label={`Remove ${field.label} item ${index + 1}`} disabled={items.length <= (field.min_items || 0)} onClick={() => onChange(items.filter((_, at) => at !== index))}><Trash2 size={13} /></button></div>{children.map(child => <Field key={child.name} field={child} value={item?.[child.name]} prefix={`${prefix}${field.name}-${index}-`} projectImages={projectImages} onImageUpload={onImageUpload} onChange={next => onChange(items.map((old, at) => at === index ? { ...old, [child.name]: next } : old))} />)}</div>)}
      <button type="button" className="btn btn-outline btn-sm w-full" disabled={items.length >= (field.max_items ?? 50)} onClick={() => onChange([...items, defaults(children)])}><Plus size={14} /> Add item</button>
    </fieldset>;
  }
  const shared = { id, required: field.required, 'aria-describedby': field.help || field.type === 'image' ? `${id}-help` : undefined };
  return <div className={`field ${field.type === 'checkbox' ? 'field-switch' : ''}`}>
    <label htmlFor={id}>{field.label || field.name}{field.required && <span className="required"> *</span>}</label>
    {field.type === 'checkbox' ? <input {...shared} type="checkbox" className="toggle toggle-sm toggle-primary" checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />
      : field.type === 'image' ? <ImageField id={id} field={field} value={value} onChange={onChange} projectImages={projectImages} onImageUpload={onImageUpload} />
      : field.type === 'select' ? <select {...shared} className="select select-bordered w-full" value={String(value ?? '')} onChange={event => onChange(event.target.value)}><option value="">Choose…</option>{Object.entries(field.options || {}).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      : ['textarea', 'markdown', 'wysiwyg'].includes(field.type) ? <textarea {...shared} className="textarea textarea-bordered w-full" rows={4} value={String(value ?? '')} onChange={event => onChange(event.target.value)} />
      : field.type === 'color' ? <div className="color-input"><input type="color" aria-label={`Choose ${field.label}`} value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#e75d45'} onChange={event => onChange(event.target.value)} /><input {...shared} className="input input-bordered w-full" value={String(value ?? '')} onChange={event => onChange(event.target.value)} /></div>
      : <input {...shared} className="input input-bordered w-full" type={['number', 'range'].includes(field.type) ? 'number' : ['url', 'email'].includes(field.type) ? field.type : 'text'} min={field.min} max={field.max} step={field.step ?? 'any'} value={value ?? ''} placeholder={field.type === 'image' ? 'images/photo.jpg' : undefined} onChange={event => onChange(['number', 'range'].includes(field.type) && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />}
    {(field.help || field.type === 'image') && <p className="field-help" id={`${id}-help`}>{field.help || 'Choose an image already in the project or add one from your computer.'}</p>}
  </div>;
}

export default function ParameterForm({ definition, values, onChange, projectImages = [], onImageUpload }) {
  return <div className="parameter-form">{definition.sections.map(section => <section className="parameter-section" key={section.id}><h3>{section.label}</h3>{section.fields.map(field => <Field key={field.name} field={field} value={values[field.name]} projectImages={projectImages} onImageUpload={onImageUpload} onChange={next => onChange({ ...values, [field.name]: next })} />)}</section>)}{!definition.fields?.length && !definition.sections.some(section => section.fields.length) && <p className="muted">Add @param declarations to build your form.</p>}</div>;
}
