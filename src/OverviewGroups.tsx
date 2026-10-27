import {useState} from 'react';
import type {Agent,Organization} from './types';
export function OverviewGroups({agents,organization,onChange,onOpen,renderAvatar,disabled=false}:{disabled?:boolean;agents:Agent[];organization:Organization;onChange:(o:Organization)=>void;onOpen:(a:Agent)=>void;renderAvatar:(a:Agent)=>React.ReactNode}){
 const [context,setContext]=useState<Agent|null>(null),[draft,setDraft]=useState<{id:string|null;name:string}|null>(null),[deleting,setDeleting]=useState<string|null>(null);
 const move=(id:string,target:string,before?:string)=>{
  if(disabled||id===before||!agents.some(a=>a.id===id))return;
  if(target==='__pinned__'){
   const pins=organization.pins.filter(p=>p!==id);const at=before?pins.indexOf(before):-1;pins.splice(at<0?pins.length:at,0,id);onChange({...organization,pins});return;
  }
  const sections=organization.sections.map(s=>({...s,agentIds:s.agentIds.filter(a=>a!==id)}));
  const group=sections.find(s=>s.id===target);if(group){const at=before?group.agentIds.indexOf(before):-1;group.agentIds.splice(at<0?group.agentIds.length:at,0,id);}
  onChange({...organization,sections});setContext(null);
 };
 const byId=(ids:string[])=>ids.map(id=>agents.find(a=>a.id===id)).filter((a):a is Agent=>!!a);
 const assigned=new Set(organization.sections.flatMap(s=>s.agentIds));
 const groups=[{id:'__pinned__',name:'Pinned',agents:byId(organization.pins)},...organization.sections.map(s=>({...s,agents:byId(s.agentIds).filter(a=>!organization.pins.includes(a.id))})),{id:'__unassigned__',name:'Ungrouped',agents:agents.filter(a=>!assigned.has(a.id)&&!organization.pins.includes(a.id))}];
 const drop=(e:React.DragEvent,target:string,before?:string)=>{e.preventDefault();move(e.dataTransfer.getData('application/x-grokdeck-agent'),target,before);};
 return <section aria-label="Agents by group" className="overview-groups"><fieldset aria-busy={disabled} className="organization-controls">
  <div className="list-heading"><h2>Your agents</h2><button disabled={disabled} className="button" onClick={()=>setDraft({id:null,name:''})}>New group</button></div>
  <p className="search-caption">Groups and pins sync with Grok Bot. Connect live to edit. Drag to reorder or move; right-click for more options.</p>
  {groups.map(group=><section key={group.id} className="agent-group" aria-label={`${group.name} group`} onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,group.id)}>
   <div className="list-heading"><h3>{group.name} <small>{group.agents.length}</small></h3>{!group.id.startsWith('__')&&<div><button className="button small-button" disabled={disabled} aria-label={`Rename ${group.name}`} onClick={()=>setDraft({id:group.id,name:group.name})}>Rename</button><button className="button small-button" disabled={disabled} aria-label={`Delete ${group.name}`} onClick={()=>setDeleting(group.id)}>Delete group</button></div>}</div>
   {group.agents.map(a=><div className="agent-row" key={a.id} draggable={!disabled} onDragStart={e=>{e.dataTransfer.setData('application/x-grokdeck-agent',a.id);e.dataTransfer.effectAllowed='move';}} onDrop={e=>{e.stopPropagation();drop(e,group.id,a.id);}} onContextMenu={e=>{e.preventDefault();if(!disabled)setContext(a);}}>
    <button className="agent-main" onClick={()=>onOpen(a)}>{renderAvatar(a)}<div className="agent-copy"><strong>{a.name}</strong><p>{a.preview}</p></div></button>
    <button className="button small-button" disabled={disabled} aria-label={`Organize ${a.name}`} onClick={()=>setContext(a)}>Move / pin</button>
   </div>)}
   {!group.agents.length&&<p className="group-drop-hint">Drop an agent here</p>}
  </section>)}
  {context&&<div className="editor-backdrop"><section className="agent-editor" role="dialog" aria-label={`Organize ${context.name}`}><h2>{context.name}</h2>
   <button className="button" onClick={()=>{onChange({...organization,pins:organization.pins.includes(context.id)?organization.pins.filter(id=>id!==context.id):[...organization.pins,context.id]});setContext(null);}}>{organization.pins.includes(context.id)?'Unpin':'Pin to top'}</button>
   <label>Move to group<select aria-label="Move to group" value="" onChange={e=>move(context.id,e.target.value)}><option value="" disabled>Choose group…</option>{organization.sections.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}<option value="__unassigned__">Ungrouped</option></select></label>
   <button className="button" onClick={()=>setContext(null)}>Close</button></section></div>}
  {draft&&<div className="editor-backdrop"><form className="agent-editor" role="dialog" aria-label={draft.id?'Rename group':'New group'} onSubmit={e=>{e.preventDefault();const name=draft.name.trim();if(!name)return;onChange({...organization,sections:draft.id?organization.sections.map(s=>s.id===draft.id?{...s,name}:s):[...organization.sections,{id:crypto.randomUUID(),name,agentIds:[]}]});setDraft(null);}}><h2>{draft.id?'Rename group':'New group'}</h2><label>Group name<input autoFocus aria-label="Group name" maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><button className="button primary" disabled={!draft.name.trim()}>Save group</button><button type="button" className="button" onClick={()=>setDraft(null)}>Cancel</button></form></div>}
  {deleting&&<div className="editor-backdrop"><section className="agent-editor" role="dialog" aria-label="Delete group"><h2>Delete this group?</h2><p>Its agents move to Ungrouped. No agents or conversations are deleted.</p><button className="button" onClick={()=>{onChange({...organization,sections:organization.sections.filter(s=>s.id!==deleting)});setDeleting(null);}}>Delete group only</button><button className="button" onClick={()=>setDeleting(null)}>Cancel</button></section></div>}
 </fieldset></section>;
}
