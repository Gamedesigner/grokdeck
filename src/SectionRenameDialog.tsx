import {useEffect, useId, useRef, useState} from 'react';

export function SectionRenameDialog({name,busy,disabled,error,onSave,onClose}:{name:string;busy:boolean;disabled:boolean;error:string;onSave:(name:string)=>Promise<void>;onClose:()=>void}) {
  const [draft,setDraft]=useState(name);
  const titleId=useId(),descriptionId=useId();
  const form=useRef<HTMLFormElement>(null),input=useRef<HTMLInputElement>(null);
  const state=useRef({busy,onClose});state.current={busy,onClose};
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    input.current?.focus();input.current?.select();
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();event.stopImmediatePropagation();
        if(!state.current.busy)state.current.onClose();
      }
      if(event.key!=='Tab'||!form.current)return;
      const controls=[...form.current.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')];
      const first=controls[0],last=controls.at(-1);
      if(!first||!last){event.preventDefault();form.current.focus();}
      else if(event.shiftKey&&(document.activeElement===first||!form.current.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!form.current.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    const focusin=(event:FocusEvent)=>{
      if(event.target instanceof Node&&!form.current?.contains(event.target)){
        const target=form.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')||form.current;
        target?.focus();
      }
    };
    document.addEventListener('keydown',keydown,true);document.addEventListener('focusin',focusin);
    return()=>{
      document.removeEventListener('keydown',keydown,true);document.removeEventListener('focusin',focusin);
      document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();
    };
  },[]);
  return <div className="editor-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy){event.preventDefault();onClose();}}}>
    <form ref={form} tabIndex={-1} className="agent-editor section-rename-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy}
      onSubmit={event=>{event.preventDefault();if(!disabled&&draft.trim())void onSave(draft.trim());}}>
      <h2 id={titleId}>Rename section</h2>
      <p id={descriptionId}>The new name will also appear in Grok Bot.</p>
      <label>Section name<input ref={input} maxLength={100} value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)}/></label>
      {error&&<p role="alert">{error}</p>}
      <button type="submit" className="button primary" disabled={disabled||!draft.trim()}>{busy?'Saving…':'Save name'}</button>
      <button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button>
    </form>
  </div>;
}
