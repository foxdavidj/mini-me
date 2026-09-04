import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReviewItem } from "../review";

export const Route=createFileRoute('/')({component:Dashboard});
type Snapshot={items:ReviewItem[];csrf:string;schedule:string;accounts:{email:string}[];counts:{email:string;inboxUnread:number;remaining:boolean}[];runs:{id:string;started_at:string;finished_at:string|null;status:string;detail:string;processed:number}[];undo:{key:string;state:string}[];message:string|null};
const date=(iso:string)=>new Date(iso).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function Dashboard(){
  const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [tab,setTab]=useState('attention'),[selected,setSelected]=useState<string[]>([]),[account,setAccount]=useState('all');
  async function refresh(){const r=await fetch('/api/review');if(!r.ok)throw new Error(r.status===403?'Your session expired. Reopen your private dashboard link.':'Could not load the review.');setData(await r.json() as Snapshot);}
  useEffect(()=>{void refresh().catch(e=>setError((e as Error).message));},[]);
  async function action(action:'keep'|'reviewed'|'archive'|'undo',keys:string[]){
    if(!data || !keys.length)return;setBusy(true);setNotice('');
    try{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,keys,csrf:data.csrf})});if(!r.ok)throw new Error('Action failed. Refresh the page and try again.');const result=await r.json() as {ok:boolean;message:string}[];setNotice(result.length===1?result[0]!.message:`${result.filter(x=>x.ok).length} of ${result.length} saved.${result.some(x=>!x.ok)?' Some items need another look in Recent activity.':''}`);setSelected([]);await refresh();}
    catch(e){setNotice((e as Error).message);}finally{setBusy(false);}
  }
  const pending=data?.items.filter(x=>x.status==='pending'&&(account==='all'||x.email===account))??[];
  const groups=[{id:'attention',label:'Needs you',hint:'Decisions, security notices, and things to follow up on.'},{id:'digest',label:'Worth reading',hint:'Your newsletters, condensed. AI, marketing, design opportunities, and D&D are all welcome.'},{id:'archive',label:'Ready to archive',hint:'Review these suggestions, then select what can leave your inbox.'},{id:'record',label:'Records & other',hint:'Receipts, account notices, and mail kept for reference.'},{id:'history',label:'Recent activity',hint:'Your past decisions and a way to restore mail to the inbox.'}];
  const inTab=(x:ReviewItem)=>tab==='record'?['record','keep'].includes(x.category):x.category===tab;
  const shown=tab==='history'?(data?.items.filter(x=>x.status!=='pending'&&(account==='all'||x.email===account))??[]):pending.filter(inTab);
  const selectable=shown.filter(x=>x.status==='pending'&&['archive','digest'].includes(x.category));
  const last=data?.runs[0];
  return <main><header><a className="brand" href="/">mini me<span> / mail</span></a><a className="subtle-link" href="/accounts">Manage accounts ↗</a></header>
    <section className="hero"><div><div className="eyebrow">YOUR MORNING, A LITTLE LIGHTER</div><h1>Less inbox.<br/><em>More headspace.</em></h1><p>A short read. A few decisions. Then on with your day.</p></div><aside className="schedule"><span className="dot"/> {data?.schedule??'Loading your review…'}<small>{last?`Last run: ${date(last.started_at)} PT · ${last.status}`:'Your first review will appear here.'}</small><small>{data?.accounts.length??0} mailboxes connected · {pending.length} items to review</small></aside></section>
    {error&&<div role="alert" className="notice">{error}</div>}
    {notice&&<div role="status" className="notice">{notice}</div>}
    {data?.message&&<div className="notice">{data.message}</div>}
    {last&&last.status!=='success'&&<div className="notice" role="status">{last.status==='running'?'A review is in progress. Reload to see new results.':last.detail}</div>}
    {data?.counts.some(x=>x.remaining)&&<p className="coverage">The first inbox pass is still in progress. Each daily run reviews up to 60 new items per mailbox and keeps working through the backlog.</p>}
    <div className="toolbar"><nav aria-label="Review sections">{groups.map(g=><button key={g.id} className={tab===g.id?'tab active':'tab'} onClick={()=>{setTab(g.id);setSelected([]);}}>{g.label}<span>{g.id==='history'?data?.items.filter(x=>x.status!=='pending').length??0:pending.filter(x=>g.id==='record'?['record','keep'].includes(x.category):x.category===g.id).length}</span></button>)}</nav><select aria-label="Mailbox" value={account} onChange={e=>{setAccount(e.target.value);setSelected([]);}}><option value="all">All mailboxes</option>{data?.accounts.map(a=><option key={a.email}>{a.email}</option>)}</select></div>
    <div className="section-title"><div><h2>{groups.find(g=>g.id===tab)?.label}</h2><p>{groups.find(g=>g.id===tab)?.hint}</p></div>{selectable.length>0&&<div className="batch"><label><input type="checkbox" checked={selectable.every(x=>selected.includes(x.key))} onChange={e=>setSelected(e.target.checked?selectable.slice(0,50).map(x=>x.key):[])}/> Select up to 50</label><button className="primary" disabled={busy||!selected.length} onClick={()=>void action('archive',selected)}>Archive selected ({selected.length})</button></div>}</div>
    {!data&&!error&&<div className="empty">Opening your morning review…</div>}
    {data&&!shown.length&&<div className="empty"><span>✓</span><h3>Nothing waiting here.</h3><p>New items will appear after the next review.</p></div>}
    <div className={tab==='digest'?'cards digest-cards':'cards'}>{shown.map(item=><article className="card" key={item.key}>
      <div className="card-meta"><span>{item.group}</span><time dateTime={item.receivedAt}>{date(item.receivedAt)} PT</time></div>
      <div className="card-heading">{selectable.some(x=>x.key===item.key)&&<input aria-label={`Select ${item.subject}`} type="checkbox" checked={selected.includes(item.key)} disabled={busy} onChange={e=>setSelected(v=>e.target.checked?[...v,item.key].slice(0,50):v.filter(k=>k!==item.key))}/>}<h3>{item.subject||'(No subject)'}</h3></div>
      <p className="summary">{item.summary}</p><p className="reason">{item.reason}</p>
      <div className="source"><span>{item.from}</span><span>{item.email}</span></div>
      <div className="card-actions">{item.status==='pending'?<><button disabled={busy} onClick={()=>void action('keep',[item.key])}>Keep in inbox</button><button disabled={busy} onClick={()=>void action('reviewed',[item.key])}>Reviewed</button></>:<span className="status">{item.status}</span>}{data?.undo.some(x=>x.key===item.key&&['archived','uncertain'].includes(x.state))&&<button disabled={busy} onClick={()=>void action('undo',[item.key])}>Restore to inbox</button>}<Original itemKey={item.key}/></div>
    </article>)}</div>
    <footer>Daily reviews prepare suggestions. Archiving happens when you choose it. <span>Unread state is preserved.</span></footer>
  </main>;
}
function Original({itemKey}:{itemKey:string}){
 const [content,setContent]=useState<{text:string;textTruncated:boolean}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 async function load(){if(content||loading)return;setLoading(true);setError('');try{const r=await fetch('/api/message?key='+encodeURIComponent(itemKey));if(!r.ok)throw new Error('Could not load the original. Check the mailbox connection.');setContent(await r.json() as {text:string;textTruncated:boolean});}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 return <details className="original" onToggle={e=>{if(e.currentTarget.open)void load();}}><summary>Read original</summary>{loading?<p>Loading…</p>:error?<p>{error}</p>:<><p>Plain text · Gmail unread state preserved · Attachments omitted{content?.textTruncated?' · Long message truncated':''}</p><pre>{content?.text}</pre></>}</details>;
}
