import {useEffect,useState} from 'react';
import type {AgentProfile,Bridge} from './types';
export function AgentEditor({bridge,id,onClose,onSaved}:{bridge:Bridge;id:string;onClose:()=>void;onSaved:()=>void}){
 const [original,setOriginal]=useState<AgentProfile|null>(null),[profile,setProfile]=useState<AgentProfile|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[image,setImage]=useState<string|null|undefined>();
 useEffect(()=>{let active=true;void bridge.agentProfile!(id).then(r=>{if(active){setOriginal(r.profile);setProfile(r.profile);}}).catch(()=>{if(active)setError('Could not load agent properties. Open Grok Bot or reconnect live.');});return()=>{active=false;};},[bridge,id]);
 const choose=async(file?:File)=>{
  if(!file)return;
  setBusy(true);setError('');
  try{
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error();
   const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
   const ctx=canvas.getContext('2d')!;const ratio=Math.min(256/bitmap.width,256/bitmap.height);ctx.drawImage(bitmap,(256-bitmap.width*ratio)/2,(256-bitmap.height*ratio)/2,bitmap.width*ratio,bitmap.height*ratio);bitmap.close();
   const png=canvas.toDataURL('image/png').split(',')[1];if(png.length>180000)throw Error();setImage(png);
  }catch{setError('Choose a PNG, JPEG or WebP image under 5 MB. A simpler image may be needed.');}finally{setBusy(false);}
 };
 const save=async()=>{
  if(!profile||!original)return;setBusy(true);setError('');
  try{
   const saved=await bridge.updateAgentProfile!(id,profile,original);setOriginal(saved.profile);setProfile(saved.profile);
   if(image!==undefined)await bridge.setAgentAvatar!(id,image);
   onSaved();onClose();
  }catch{setError('Save could not be fully confirmed. Properties may have saved before the image. Close and reopen to check Grok Bot before trying again.');}finally{setBusy(false);}
 };
 return <div className="editor-backdrop"><section className="agent-editor" role="dialog" aria-modal="true" aria-label="Edit agent">
  <h2>Edit agent</h2><p>Changes are saved to your Grok Bot agent.</p>
  {error&&<p role="alert">{error}</p>}
  {profile?<><label>Name<input aria-label="Agent name" maxLength={200} value={profile.name} disabled={busy} onChange={e=>setProfile({...profile,name:e.target.value})}/></label>
   <label>Title<input aria-label="Agent title" maxLength={500} value={profile.title} disabled={busy} onChange={e=>setProfile({...profile,title:e.target.value})}/></label>
   <label>Description<textarea aria-label="Agent description" maxLength={50000} value={profile.description} disabled={busy} onChange={e=>setProfile({...profile,description:e.target.value})}/></label>
   <label>Agent image<input aria-label="Agent image" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>void choose(e.target.files?.[0])}/></label>
   {image&&<img className="agent-image-preview" src={'data:image/png;base64,'+image} alt="New agent image preview"/>}
   {image===null&&<p>Custom image will be removed when you save.</p>}
   <button className="button" disabled={busy} onClick={()=>setImage(null)}>Remove custom image</button>
   <button className="button primary" disabled={busy||!profile.name.trim()} onClick={()=>void save()}>{busy?'Saving…':'Save changes'}</button>
  </>:!error&&<p>Loading properties…</p>}
  <button className="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button" onClick={()=>void bridge.openAgent(id)}>Open in Grok Bot</button>
 </section></div>;
}
