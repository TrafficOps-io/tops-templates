import React, {useEffect, useState} from 'react';
import {Box, Text, render, useApp, useInput} from 'ink';
import {getDefaults, validateValues} from '../../runtime/src/index.js';

const h = React.createElement;
const clone = (value) => JSON.parse(JSON.stringify(value));
const read = (data, path) => path.reduce((value, key) => value[key], data);
function assign(data, path, value) { const next = clone(data); let parent = next; for (const key of path.slice(0,-1)) parent = parent[key]; parent[path.at(-1)] = value; return next; }
export function promptsFor(fields, values, prefix = [], label = '') {
  return fields.flatMap((field) => {
    const path = [...prefix,field.name], title = label + field.label;
    if (field.type === 'group') return promptsFor(field.fields, values[field.name], path, `${title} / `);
    if (field.type === 'repeater') return [{field, path, title:`${title} — number of items`, count:true}, ...values[field.name].flatMap((item,index) => promptsFor(field.fields, item, [...path,index], `${title} ${index + 1} / `))];
    return [{field, path, title}];
  });
}
function Form({definition, onComplete, onCancel}) {
  const {exit} = useApp();
  const [data, setData] = useState(() => getDefaults(definition));
  const [index,setIndex] = useState(0), [input,setInput] = useState(''), [error,setError] = useState('');
  const prompts = promptsFor(definition.fields, data), prompt = prompts[index];
  useEffect(() => {
    setError('');
    if (!prompt) return;
    const value = read(data,prompt.path); setInput(String(prompt.count ? value.length : value));
  }, [index]);
  useInput((character, key) => {
    if (key.escape || key.ctrl && character === 'c') { onCancel(); exit(); return; }
    if (key.ctrl && character === 'b') { if (index > 0) setIndex(index - 1); return; }
    if (!prompt) return;
    const {field,count,path} = prompt;
    if (key.return) {
      try {
        let value;
        if (count) {
          const number = Number(input);
          if (!/^\d+$/.test(input) || number < field.min_items || number > field.max_items) throw new Error(`Choose ${field.min_items}–${field.max_items} items`);
          const old = read(data,path), item = getDefaults({fields:field.fields}); value = Array.from({length:number}, (_,i) => old[i] ?? clone(item));
        } else {
          value = ['number','range'].includes(field.type) ? Number(input) : field.type === 'checkbox' ? input === 'true' : input.replace(/\\n/g, '\n');
          if (['number','range'].includes(field.type) && !input.trim()) throw new Error('Enter a number');
          value = validateValues({fields:[field]}, {[field.name]:value})[field.name];
        }
        const next = assign(data,path,value), nextPrompts = promptsFor(definition.fields,next);
        setData(next);
        if (index + 1 >= nextPrompts.length) { const normalized = validateValues(definition,next); onComplete(normalized); exit(); }
        else setIndex(index + 1);
      } catch (cause) { setError(cause.message); }
      return;
    }
    if (field.type === 'checkbox') { if (character === ' ' || key.leftArrow || key.rightArrow || key.upArrow || key.downArrow) setInput(input === 'true' ? 'false' : 'true'); return; }
    if (field.type === 'select') {
      const options = Object.keys(field.options), current = Math.max(0, options.indexOf(input));
      if (key.leftArrow || key.upArrow) setInput(options[(current + options.length - 1) % options.length]);
      if (key.rightArrow || key.downArrow) setInput(options[(current + 1) % options.length]);
      return;
    }
    if (key.ctrl && character === 'u') setInput('');
    else if (key.backspace || key.delete) setInput((value) => [...value].slice(0,-1).join(''));
    else if (!key.ctrl && !key.meta && !key.escape && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow) setInput((value) => value + character.replace(/[\x00-\x1f\x7f]/g,''));
  });
  useEffect(() => { if (!prompts.length) { onComplete(validateValues(definition,data)); exit(); } }, []);
  if (!prompt) return h(Text,null,'Generating…');
  const {field,count} = prompt;
  const display = field.type === 'checkbox' ? input === 'true' ? '[✓] Yes' : '[ ] No' : field.type === 'select' ? `‹ ${field.options[input] ?? input} ›` : input;
  const help = count ? `${field.min_items}–${field.max_items} items` : field.type === 'checkbox' ? 'Space / arrows to toggle' : field.type === 'select' ? 'Arrow keys to choose' : field.type === 'image' ? 'Relative image path; images stay on your computer' : ['number','range'].includes(field.type) ? `Number${field.min !== undefined ? ` · min ${field.min}` : ''}${field.max !== undefined ? ` · max ${field.max}` : ''}${field.step !== undefined ? ` · step ${field.step}` : ''}` : ['textarea','markdown','wysiwyg'].includes(field.type) ? 'Use \\n for line breaks' : 'Type a value';
  return h(Box,{flexDirection:'column',padding:1},
    h(Text,{color:'#a855f7',bold:true},`TrafficOps / ${definition.name}`),
    h(Text,{dimColor:true},`Field ${index + 1} of ${prompts.length}`),
    h(Box,{marginTop:1},h(Text,{bold:true},`${prompt.title}${field.required && !count ? ' *' : ''}`)),
    field.help ? h(Text,{dimColor:true},field.help) : null,
    h(Box,{borderStyle:'round',borderColor:error ? 'red' : '#a855f7',paddingX:1},h(Text,null,`${display}▏`)),
    h(Text,{dimColor:true},help),
    error ? h(Text,{color:'red'},error) : null,
    h(Box,{marginTop:1},h(Text,{dimColor:true},'Enter: next / generate · Ctrl+U: clear · Ctrl+B: back · Esc: cancel')));
}
export function promptValues(definition) {
  return new Promise((resolve,reject) => {
    render(h(Form,{definition,onComplete:resolve,onCancel:() => reject(new Error('Generation cancelled'))}), {exitOnCtrlC:false});
  });
}
