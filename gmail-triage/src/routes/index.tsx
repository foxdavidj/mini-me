import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { groupMessages } from "../newsletters";
import type { ReviewItem } from "../review";

export const Route=createFileRoute('/')({component:Dashboard});
type Snapshot={answers:{key:string;answer:string;answered_at:string}[];items:ReviewItem[];csrf:string;schedule:string;accounts:{email:string}[];counts:{email:string;inboxUnread:number;remaining:boolean}[];runs:{id:string;started_at:string;finished_at:string|null;status:string;detail:string;processed:number}[];undo:{key:string;state:string}[];message:string|null};
const date=(iso:string)=>new Date(iso).toLocaleString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function Dashboard(){
  const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [tab,setTab]=useState('attention'),[selected,setSelected]=useState<string[]>([]),[account,setAccount]=useState('all');
  async function refresh(){const r=await fetch('/api/review');if(!r.ok)throw new Error(r.status===403?'Your session expired. Reopen your private dashboard link.':'Could not load the review.');setData(await r.json() as Snapshot);}
  useEffect(()=>{void refresh().catch(e=>setError((e as Error).message));},[]);
  async function action(action:'keep'|'reviewed'|'archive'|'undo',keys:string[]){
    if(!data || !keys.length)return;setBusy(true);setNotice('');
    try{
      const result:{ok:boolean;message:string}[]=[];
      for(let i=0;i<keys.length;i+=50){
        const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,keys:keys.slice(i,i+50),csrf:data.csrf})});
        if(!r.ok)throw new Error('Action failed. Refresh to see completed changes before retrying.');
        result.push(...await r.json() as {ok:boolean;message:string}[]);
      }
      setNotice(result.length===1?result[0]!.message:`${result.filter(x=>x.ok).length} of ${result.length} saved.${result.some(x=>!x.ok)?' Some items need another look in Recent activity.':''}`);setSelected([]);await refresh();
    }
    catch(e){setNotice((e as Error).message);}finally{setBusy(false);}
  }
  const pending=data?.items.filter(x=>x.status==='pending'&&(account==='all'||x.email===account))??[];
  const groups=[{id:'attention',label:'Questions',hint:'Only the decisions I need from you. I handle the rest.'},{id:'digest',label:'Saved reading',hint:'Optional reference material, separate from your brief.'},{id:'archive',label:'Ready to archive',hint:'Cleanup awaiting completion. I normally handle this automatically.'},{id:'record',label:'Records & other',hint:'Receipts, account notices, and mail kept for reference.'},{id:'history',label:'Recent activity',hint:'Your past decisions and a way to restore mail to the inbox.'}];
  const inTab=(x:ReviewItem)=>tab==='record'?['record','keep'].includes(x.category):x.category===tab;
  const shown=tab==='history'?(data?.items.filter(x=>x.status!=='pending'&&(account==='all'||x.email===account))??[]):pending.filter(inTab);
  const selectable=shown.filter(x=>!['archived','archiving','uncertain'].includes(x.status));
  const last=data?.runs[0];
  const renderItem=(item:ReviewItem)=>(<article className="card" key={item.key}>
      <div className="card-meta"><span>{item.group}</span><time dateTime={item.receivedAt}>{date(item.receivedAt)} PT</time></div>
      <div className="card-heading">{selectable.some(x=>x.key===item.key)&&<input aria-label={`Select ${item.subject}`} type="checkbox" checked={selected.includes(item.key)} disabled={busy} onChange={e=>setSelected(v=>e.target.checked?[...v,item.key]:v.filter(k=>k!==item.key))}/>}<h3>{item.subject||'(No subject)'}</h3></div>
      <p className="summary">{item.summary}</p><p className="reason">{item.reason}</p>
      <div className="source"><span>{item.from}</span><span>{item.email}</span></div>
      {item.category==='attention'&&item.status==='pending'&&data&&<Answer itemKey={item.key} csrf={data.csrf} onSaved={refresh}/>}
      {data?.answers.filter(x=>x.key===item.key).map(x=><p key={x.answered_at} className="answer-saved">Your answer: {x.answer}</p>)}
      <div className="card-actions">{item.status==='pending'?<><button disabled={busy} onClick={()=>void action('keep',[item.key])}>Keep in inbox</button><button disabled={busy} onClick={()=>void action('reviewed',[item.key])}>Reviewed</button></>:<span className="status">{item.status==='following_up'?'I’m following up':item.status}</span>}{data?.undo.some(x=>x.key===item.key&&['archived','uncertain'].includes(x.state))&&<button disabled={busy} onClick={()=>void action('undo',[item.key])}>Restore to inbox</button>}<Original itemKey={item.key}/></div>
    </article>);
  return <main><header><a className="brand" href="/">mini me<span> / mail</span></a><a className="subtle-link" href="/accounts">Manage accounts ↗</a></header>
    <section className="hero"><div><div className="eyebrow">YOUR MORNING, A LITTLE LIGHTER</div><h1>Less inbox.<br/><em>More headspace.</em></h1><p>I handle the inbox. You answer only what needs your judgment.</p></div><aside className="schedule"><span className="dot"/> {data?.schedule??'Loading your review…'}<small>{last?`Last run: ${date(last.started_at)} PT · ${last.status}`:'Your first review will appear here.'}</small><small>{data?.accounts.length??0} mailboxes connected · {pending.length} items to review</small></aside></section>
    {error&&<div role="alert" className="notice">{error}</div>}
    {notice&&<div role="status" className="notice">{notice}</div>}
    {data?.message&&<div className="notice">{data.message}</div>}
    {last&&last.status!=='success'&&<div className="notice" role="status">{last.status==='running'?'A review is in progress. Reload to see new results.':last.detail}</div>}
    {data?.counts.some(x=>x.remaining)&&<p className="coverage">The first inbox pass is still in progress. The reviewer keeps working through new mail and unresolved follow-ups.</p>}
    <div className="toolbar"><nav aria-label="Review sections">{groups.map(g=><button key={g.id} className={tab===g.id?'tab active':'tab'} onClick={()=>{setTab(g.id);setSelected([]);}}>{g.label}<span>{g.id==='history'?data?.items.filter(x=>x.status!=='pending').length??0:pending.filter(x=>g.id==='record'?['record','keep'].includes(x.category):x.category===g.id).length}</span></button>)}</nav><select aria-label="Mailbox" value={account} onChange={e=>{setAccount(e.target.value);setSelected([]);}}><option value="all">All mailboxes</option>{data?.accounts.map(a=><option key={a.email}>{a.email}</option>)}</select></div>
    <div className="section-title"><div><h2>{groups.find(g=>g.id===tab)?.label}</h2><p>{groups.find(g=>g.id===tab)?.hint}</p></div>{selectable.length>0&&<div className="batch"><label><input type="checkbox" checked={selectable.every(x=>selected.includes(x.key))} onChange={e=>setSelected(e.target.checked?selectable.map(x=>x.key):[])}/> Select all</label><button className="primary" disabled={busy||!selected.length} onClick={()=>void action('archive',selected)}>Archive selected ({selected.length})</button></div>}</div>
    {!data&&!error&&<div className="empty">Opening your morning review…</div>}
    {data&&!shown.length&&<div className="empty"><span>✓</span><h3>Nothing waiting here.</h3><p>New items will appear after the next review.</p></div>}
    <div className={tab==='digest'?'cards digest-cards':'cards'}>{tab==='attention'?shown.map(renderItem):groupMessages(shown).map(group=><details className="sender-group" key={group.key} open={group.items.length===1}><summary>{group.name} <span>{group.items.length} messages</span></summary>{group.items.map(renderItem)}</details>)}</div>
    <footer>I read and organize your mail. Every archive can be restored. <span>Unread state is preserved.</span></footer>
  </main>;
}
function Original({itemKey}:{itemKey:string}){
 const [content,setContent]=useState<{text:string;textTruncated:boolean}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 async function load(){if(content||loading)return;setLoading(true);setError('');try{const r=await fetch('/api/message?key='+encodeURIComponent(itemKey));if(!r.ok)throw new Error('Could not load the original. Check the mailbox connection.');setContent(await r.json() as {text:string;textTruncated:boolean});}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 return <details className="original" onToggle={e=>{if(e.currentTarget.open)void load();}}><summary>Read original</summary>{loading?<p>Loading…</p>:error?<p>{error}</p>:<><p>Plain text · Gmail unread state preserved · Attachments omitted{content?.textTruncated?' · Long message truncated':''}</p><pre>{content?.text}</pre></>}</details>;
}

function Answer({itemKey,csrf,onSaved}:{itemKey:string;csrf:string;onSaved:()=>Promise<void>}){
 const [answer,setAnswer]=useState(''),[saving,setSaving]=useState(false),[error,setError]=useState('');
 return <form className="answer-form" onSubmit={async e=>{e.preventDefault();setSaving(true);setError('');try{const response=await fetch('/api/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:itemKey,csrf,answer})});if(!response.ok)throw Error('Could not save your answer.');await onSaved();}catch(e){setError((e as Error).message);}finally{setSaving(false);}}}>
 <label>Your answer<textarea value={answer} onChange={e=>setAnswer(e.target.value)} rows={2} maxLength={8000} placeholder="Tell me once. I’ll remember." required/></label><button className="primary" disabled={saving||!answer.trim()}>Save answer</button>{error&&<p role="alert">{error}</p>}
 </form>;
}
